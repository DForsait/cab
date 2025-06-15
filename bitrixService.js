// bitrix/bitrixService.js - OAuth версия с ИСПРАВЛЕННОЙ пагинацией
const axios = require('axios');
const bitrixTokenManager = require('../utils/bitrixTokenManager');

/**
 * Базовый метод для запросов к Bitrix24 через OAuth
 */
async function bitrixRequest(method, params = {}) {
  try {
    const accessToken = await bitrixTokenManager.getAccessToken();
    const tokenData = bitrixTokenManager.getTokenData();
    
    const url = `${tokenData.client_endpoint}${method}`;
    
    const response = await axios.post(url, {
      ...params,
      auth: accessToken // OAuth токен
    });

    if (response.data.error) {
      console.error(`❌ Ошибка Bitrix API [${method}]:`, response.data.error_description);
      throw new Error(`Bitrix API Error: ${response.data.error_description}`);
    }

    return response.data;

  } catch (error) {
    console.error(`❌ Ошибка bitrixRequest [${method}]:`, error.message);
    
    // Если токен истек - пробуем обновить и повторить
    if (error.response?.status === 401) {
      console.log('🔄 Токен истек, обновляем...');
      await bitrixTokenManager.refreshTokens();
      
      // Повторный запрос с новым токеном
      const newAccessToken = await bitrixTokenManager.getAccessToken();
      const tokenData = bitrixTokenManager.getTokenData();
      
      const retryResponse = await axios.post(`${tokenData.client_endpoint}${method}`, {
        ...params,
        auth: newAccessToken
      });
      
      if (retryResponse.data.error) {
        throw new Error(`Bitrix API Error: ${retryResponse.data.error_description}`);
      }
      
      return retryResponse.data;
    }
    
    throw error;
  }
}

/**
 * Получение источников лидов из Bitrix24
 */
async function getLeadSources() {
  try {
    console.log('🔄 Получение источников лидов из Bitrix24 (OAuth)');
    
    const data = await bitrixRequest('crm.status.list', {
      filter: {
        ENTITY_ID: 'SOURCE' // источники лидов
      }
    });

    console.log(`✅ Получено источников: ${data.result.length}`);
    return data.result;

  } catch (error) {
    console.error('❌ Ошибка getLeadSources:', error);
    throw error;
  }
}

/**
 * ИСПРАВЛЕННАЯ функция получения лидов с правильной пагинацией
 */
async function getLeads(filters = {}, select = [], maxLeads = null) {
  try {
    console.log('🔄 Получение ВСЕХ лидов из Bitrix24 (OAuth)', { filters, maxLeads: maxLeads || 'НЕТ ЛИМИТА' });
    
    // Расширенный набор полей для точного анализа
    const defaultSelect = [
      'ID',
      'TITLE', 
      'STATUS_ID',
      'SOURCE_ID',
      'ASSIGNED_BY_ID',
      'DATE_CREATE',
      'DATE_MODIFY',
      'OPPORTUNITY',
      'COMPANY_TITLE',
      'CONTACT_ID',
      'PHONE',
      'EMAIL',
      'UF_*' // все пользовательские поля
    ];

    // Правильная обработка фильтров
    let requestParams = {
      filter: { ...filters }, // Копируем все фильтры без изменений
      select: select.length > 0 ? select : defaultSelect,
      order: { DATE_CREATE: 'DESC' }
    };

    // Логируем итоговые фильтры для отладки
    console.log('🔍 Фильтры для запроса к Bitrix24:', requestParams.filter);

    let allLeads = [];
    const seenLeadIds = new Set(); // Отслеживаем уже добавленные ID
    let start = 0;
    const limit = 50;

    // Получаем ВСЕ лиды без жестких ограничений
    while (true) {
      // Если есть лимит, проверяем его
      if (maxLeads && allLeads.length >= maxLeads) {
        console.log(`📊 Достигнут заданный лимит в ${maxLeads} лидов`);
        break;
      }
      
      const currentLimit = maxLeads ? Math.min(limit, maxLeads - allLeads.length) : limit;
      
      const data = await bitrixRequest('crm.lead.list', {
        ...requestParams,
        start,
        limit: currentLimit
      });

      const currentBatch = data.result || [];
      
      // Добавляем уникальные лиды (дедупликация)
      const uniqueLeadsInBatch = [];
      let duplicatesInBatch = 0;
      
      currentBatch.forEach(lead => {
        if (!seenLeadIds.has(lead.ID)) {
          seenLeadIds.add(lead.ID);
          uniqueLeadsInBatch.push(lead);
        } else {
          duplicatesInBatch++;
        }
      });
      
      allLeads = allLeads.concat(uniqueLeadsInBatch);
      
      console.log(`📄 Страница ${Math.floor(start/limit) + 1}: получено ${currentBatch.length} лидов, уникальных: ${uniqueLeadsInBatch.length}, дублей: ${duplicatesInBatch}, всего: ${allLeads.length}`);
      
      // ИСПРАВЛЕНО: Используем поле 'next' из ответа API для определения конца
      if (data.next !== undefined) {
        start = data.next;
        console.log(`➡️ Следующая позиция: ${start}`);
      } else {
        // Если нет поля next, но получили полную страницу - продолжаем
        if (currentBatch.length === limit) {
          start += limit;
          console.log(`➡️ Нет поля next, но страница полная. Продолжаем с позиции: ${start}`);
        } else {
          // Страница неполная и нет next - это конец
          console.log('📋 Достигнут конец списка лидов');
          break;
        }
      }
      
      // Защита от бесконечного цикла
      if (start >= 10000) {
        console.warn(`⚠️ Достигнут максимальный лимит запросов: ${start}`);
        break;
      }
    }

    console.log(`✅ ИТОГО получено уникальных лидов: ${allLeads.length}`);
    
    // Дополнительная проверка фильтрации по источнику
    if (filters.SOURCE_ID && !Array.isArray(filters.SOURCE_ID)) {
      const expectedSourceId = filters.SOURCE_ID;
      const leadsWithWrongSource = allLeads.filter(lead => lead.SOURCE_ID !== expectedSourceId);
      
      if (leadsWithWrongSource.length > 0) {
        console.warn(`⚠️ ПРОБЛЕМА: Найдено ${leadsWithWrongSource.length} лидов с неправильным источником!`);
        console.log('🔍 Примеры неправильных лидов:', 
          leadsWithWrongSource.slice(0, 3).map(lead => ({
            id: lead.ID,
            sourceId: lead.SOURCE_ID,
            expected: expectedSourceId
          }))
        );
        
        // Фильтруем вручную как fallback
        allLeads = allLeads.filter(lead => lead.SOURCE_ID === expectedSourceId);
        console.log(`🔧 После ручной фильтрации осталось: ${allLeads.length} лидов`);
      }
    }
    
    // Обогащаем данные названиями источников
    return await enrichLeadsWithSourceNames(allLeads);

  } catch (error) {
    console.error('❌ Ошибка getLeads:', error);
    throw error;
  }
}

/**
 * Получение стадий лидов
 */
async function getLeadStages() {
  try {
    console.log('🔄 Получение стадий лидов из Bitrix24 (OAuth)');
    
    const data = await bitrixRequest('crm.status.list', {
      filter: {
        ENTITY_ID: 'STATUS' // стадии лидов
      }
    });

    console.log(`✅ Получено стадий: ${data.result.length}`);
    return data.result;

  } catch (error) {
    console.error('❌ Ошибка getLeadStages:', error);
    throw error;
  }
}

/**
 * Получение конкретного лида
 */
async function getLead(leadId) {
  try {
    const data = await bitrixRequest('crm.lead.get', {
      id: leadId
    });

    return data.result;

  } catch (error) {
    console.error(`❌ Ошибка getLead для лида ${leadId}:`, error);
    throw error;
  }
}

/**
 * УЛУЧШЕННАЯ функция получения сделок по лиду
 */
async function getDealsByLead(leadId) {
  try {
    // Сначала получаем связанные контакты лида
    const lead = await getLead(leadId);
    
    if (!lead) {
      console.warn(`⚠️ Лид ${leadId} не найден`);
      return [];
    }
    
    const contactId = lead.CONTACT_ID;
    
    if (!contactId) {
      // Если нет связанного контакта, проверяем по имени/телефону
      console.log(`📞 Лид ${leadId} без контакта, ищем сделки по телефону/email`);
      return await findDealsByLeadData(lead);
    }

    // Ищем сделки по контакту
    console.log(`🔍 Поиск сделок для лида ${leadId} через контакт ${contactId}`);
    
    const data = await bitrixRequest('crm.deal.list', {
      filter: {
        CONTACT_ID: contactId
      },
      select: [
        'ID',
        'TITLE',
        'STAGE_ID', 
        'OPPORTUNITY',
        'CURRENCY_ID',
        'DATE_CREATE',
        'DATE_MODIFY',
        'ASSIGNED_BY_ID',
        'CATEGORY_ID',
        'CONTACT_ID'
      ]
    });

    const deals = data.result || [];
    console.log(`✅ Найдено сделок для лида ${leadId}: ${deals.length}`);
    return deals;

  } catch (error) {
    console.error(`❌ Ошибка getDealsByLead для лида ${leadId}:`, error);
    return []; // Возвращаем пустой массив вместо ошибки
  }
}

/**
 * НОВЫЙ метод: Получение сделок по контакту
 */
async function getDealsByContact(contactId) {
  try {
    console.log(`🔍 Запрос сделок для контакта ${contactId}`);
    
    const data = await bitrixRequest('crm.deal.list', {
      filter: {
        'CONTACT_ID': contactId
      },
      select: [
        'ID', 'TITLE', 'STAGE_ID', 'CONTACT_ID', 'COMPANY_ID', 
        'LEAD_ID', 'UF_CRM_LEAD_ID', 'ORIGINATOR_ID',
        'DATE_CREATE', 'DATE_MODIFY', 'OPPORTUNITY', 'CURRENCY_ID', 'CATEGORY_ID'
      ]
    });

    if (!data || !data.result) {
      console.log(`❌ Некорректный ответ при запросе сделок для контакта ${contactId}`);
      return [];
    }

    const deals = data.result;
    console.log(`✅ Найдено сделок для контакта ${contactId}: ${deals.length}`);
    
    return deals;

  } catch (error) {
    console.error(`❌ Ошибка получения сделок для контакта ${contactId}:`, error);
    return [];
  }
}

/**
 * Поиск сделок по данным лида (телефон, email, название)
 */
async function findDealsByLeadData(lead) {
  try {
    const phone = lead.PHONE?.[0]?.VALUE;
    const email = lead.EMAIL?.[0]?.VALUE;
    const title = lead.TITLE;
    
    if (!phone && !email && !title) {
      return [];
    }
    
    // Ищем сделки с похожими данными
    const searchFilters = [];
    
    if (phone) {
      // Поиск по телефону через контакты
      const contactsData = await bitrixRequest('crm.contact.list', {
        filter: { PHONE: phone },
        select: ['ID']
      });
      
      const contactIds = contactsData.result.map(contact => contact.ID);
      if (contactIds.length > 0) {
        searchFilters.push({ CONTACT_ID: contactIds });
      }
    }
    
    // Если ничего не нашли, возвращаем пустой массив
    if (searchFilters.length === 0) {
      return [];
    }
    
    // Ищем сделки по найденным контактам
    for (const filter of searchFilters) {
      const dealsData = await bitrixRequest('crm.deal.list', {
        filter,
        select: ['ID', 'TITLE', 'STAGE_ID', 'OPPORTUNITY', 'DATE_CREATE']
      });
      
      if (dealsData.result.length > 0) {
        return dealsData.result;
      }
    }
    
    return [];
    
  } catch (error) {
    console.error('❌ Ошибка findDealsByLeadData:', error);
    return [];
  }
}

/**
 * ОБНОВЛЕННЫЙ метод: Получение сделок с фильтрами
 */
async function getDeals(filters = {}, select = [], limit = 500) {
  try {
    console.log('🔍 Запрос сделок из Bitrix24 с фильтром:', filters);
    
    const defaultSelect = [
      'ID',
      'TITLE',
      'STAGE_ID',
      'CATEGORY_ID', 
      'OPPORTUNITY',
      'CURRENCY_ID',
      'DATE_CREATE',
      'DATE_MODIFY',
      'ASSIGNED_BY_ID',
      'CONTACT_ID',
      'COMPANY_ID',
      'LEAD_ID',
      'UF_CRM_LEAD_ID', 
      'ORIGINATOR_ID'
    ];

    const params = {
      filter: filters,
      select: select.length > 0 ? select : defaultSelect,
      order: { DATE_CREATE: 'DESC' },
      start: 0
    };

    if (limit) {
      params.limit = limit;
    }

    let allDeals = [];
    let start = 0;
    const batchLimit = 50;

    while (allDeals.length < limit) {
      const currentLimit = Math.min(batchLimit, limit - allDeals.length);
      
      const data = await bitrixRequest('crm.deal.list', {
        ...params,
        start,
        limit: currentLimit
      });

      if (!data || !data.result) {
        console.log('❌ Некорректный ответ от Bitrix24 при запросе сделок');
        break;
      }

      const currentBatch = data.result;
      allDeals = allDeals.concat(currentBatch);
      
      console.log(`📄 Получено сделок: ${currentBatch.length}, всего: ${allDeals.length}`);
      
      // ИСПРАВЛЕНО: Используем поле next для пагинации
      if (data.next !== undefined) {
        start = data.next;
      } else {
        // Если нет поля next, но получили полную страницу - продолжаем
        if (currentBatch.length === batchLimit) {
          start += batchLimit;
        } else {
          // Страница неполная и нет next - это конец
          console.log('📋 Достигнут конец списка сделок');
          break;
        }
      }
      
      // Защита от бесконечного цикла
      if (start >= 5000) {
        console.warn('⚠️ Достигнут лимит в 5000 сделок');
        break;
      }
    }

    console.log(`✅ Получено сделок: ${allDeals.length}`);
    
    // Логируем примеры сделок
    if (allDeals.length > 0) {
      console.log('📋 Пример сделок:');
      allDeals.slice(0, 3).forEach((deal, index) => {
        console.log(`  Сделка ${index + 1}:`);
        console.log(`    ID: ${deal.ID}`);
        console.log(`    TITLE: ${deal.TITLE}`);
        console.log(`    CATEGORY_ID: ${deal.CATEGORY_ID}`);
        console.log(`    CONTACT_ID: ${deal.CONTACT_ID}`);
        console.log(`    LEAD_ID: ${deal.LEAD_ID}`);
        console.log(`    UF_CRM_LEAD_ID: ${deal.UF_CRM_LEAD_ID}`);
        console.log(`    DATE_CREATE: ${deal.DATE_CREATE}`);
      });
    }

    return allDeals;

  } catch (error) {
    console.error('❌ Ошибка получения сделок:', error);
    throw error;
  }
}

/**
 * НОВЫЙ метод: Получение воронок (категорий) сделок
 */
/*async function getDealCategories() {
  try {
    console.log('🔍 Запрос воронок сделок из Bitrix24');
    
    const data = await bitrixRequest('crm.category.list', {
      entityTypeId: 2 // 2 = сделки
    });
    
    if (!data || !data.result) {
      console.log('❌ Некорректный ответ при запросе воронок сделок');
      return [];
    }

    const categories = data.result;
    console.log(`✅ Получено воронок сделок: ${categories.length}`);
    
    // Логируем все воронки
    categories.forEach(category => {
      console.log(`  Воронка: ID=${category.ID}, NAME="${category.NAME}"`);
    });
    
    return categories;

  } catch (error) {
    console.error('❌ Ошибка получения воронок сделок:', error);
    return [];
  }
}*/

/**
 * Обогащение лидов названиями источников
 */
async function enrichLeadsWithSourceNames(leads) {
  try {
    // Получаем все источники
    const sources = await getLeadSources();
    const sourceMap = {};
    
    sources.forEach(source => {
      sourceMap[source.STATUS_ID] = source.NAME;
    });

    // Добавляем названия источников к лидам
    return leads.map(lead => ({
      ...lead,
      SOURCE_NAME: sourceMap[lead.SOURCE_ID] || 'Неизвестный источник'
    }));

  } catch (error) {
    console.error('❌ Ошибка enrichLeadsWithSourceNames:', error);
    // Возвращаем лиды без обогащения в случае ошибки
    return leads.map(lead => ({
      ...lead,
      SOURCE_NAME: 'Неизвестный источник'
    }));
  }
}

/**
 * Получение пользовательских полей
 */
async function getCustomFields(entityType = 'LEAD') {
  try {
    console.log(`🔄 Получение пользовательских полей для ${entityType} (OAuth)`);
    
    const data = await bitrixRequest('crm.userfield.list', {
      filter: {
        ENTITY_ID: `CRM_${entityType}`
      }
    });

    console.log(`✅ Получено пользовательских полей: ${data.result.length}`);
    return data.result;

  } catch (error) {
    console.error(`❌ Ошибка getCustomFields для ${entityType}:`, error);
    throw error;
  }
}

/**
 * Обновление лида
 */
async function updateLead(leadId, fields) {
  try {
    console.log(`🔄 Обновление лида ${leadId}`);
    
    const data = await bitrixRequest('crm.lead.update', {
      id: leadId,
      fields: fields
    });

    console.log(`✅ Лид ${leadId} обновлен`);
    return data.result;

  } catch (error) {
    console.error(`❌ Ошибка updateLead для лида ${leadId}:`, error);
    throw error;
  }
}

/**
 * Получение источников (совместимость со старым кодом)
 */
async function getSources() {
  return getLeadSources();
}

/**
 * Получение списка пользователей (сотрудников) из Bitrix24
 * Добавить в bitrix/bitrixService.js
 */
async function getUsers(filters = {}) {
  try {
    console.log('👥 Запрос пользователей из Bitrix24');
    
    // Получаем ВСЕХ пользователей без фильтра активности
    let allUsers = [];
    let start = 0;
    const limit = 50;
    
    while (true) {
      const params = {
        select: [
          'ID',
          'NAME', 
          'LAST_NAME',
          'EMAIL',
          'ACTIVE',
          'WORK_POSITION',
          'UF_DEPARTMENT'
        ],
        filter: {
          ...filters
          // УБИРАЕМ ACTIVE: 'Y' - получаем всех пользователей
        },
        start: start,
        limit: limit
      };
      
      const response = await bitrixRequest('user.get', params);
      
      if (response && response.result && response.result.length > 0) {
        allUsers = allUsers.concat(response.result);
        console.log(`📄 Загружено пользователей: ${response.result.length}, всего: ${allUsers.length}`);
        
        // Если получили меньше лимита - это последняя страница
        if (response.result.length < limit) {
          break;
        }
        
        start += limit;
      } else {
        break;
      }
    }
    
    console.log(`✅ Получено пользователей всего: ${allUsers.length}`);
    
    // Выводим примеры пользователей
    console.log('👥 Примеры пользователей:', allUsers.slice(0, 5).map(user => ({
      id: user.ID,
      name: `${user.NAME || ''} ${user.LAST_NAME || ''}`.trim(),
      position: user.WORK_POSITION,
      active: user.ACTIVE
    })));
    
    return allUsers;
  } catch (error) {
    console.error('❌ Ошибка получения пользователей:', error);
    return [];
  }
}

// Функция поиска сотрудника по ID
function findEmployeeById(employeeId, allUsers) {
  const user = allUsers.find(u => u.ID === employeeId);
  
  if (user) {
    const name = `${user.NAME || ''} ${user.LAST_NAME || ''}`.trim();
    return {
      id: user.ID,
      name: name || `Пользователь ${employeeId}`,
      position: user.WORK_POSITION || '',
      active: user.ACTIVE === 'Y',
      email: user.EMAIL || ''
    };
  }
  
  console.log(`⚠️ Сотрудник ${employeeId} не найден среди ${allUsers.length} пользователей`);
  return {
    id: employeeId,
    name: `Сотрудник ${employeeId}`,
    position: '',
    active: false,
    email: ''
  };
}

// Оптимизированная функция связывания продаж с источниками (быстрая версия)
/*async function linkSalesToSources(sales, leads) {
  console.log(`🔗 Связываем ${sales.length} продаж с ${leads.length} лидами`);
  const enrichedLeads = await enrichLeadsWithSourceNames(leads);
  
  // 1. БЫСТРЫЙ ИНДЕКС ЛИДОВ ПО CONTACT_ID (только самый ранний лид каждого контакта)
  const earliestLeadByContact = {};
  
  enrichedLeads.forEach(lead => {
    if (lead.CONTACT_ID) {
      const existing = earliestLeadByContact[lead.CONTACT_ID];
      if (!existing || new Date(lead.DATE_CREATE) < new Date(existing.DATE_CREATE)) {
        earliestLeadByContact[lead.CONTACT_ID] = lead;
      }
    }
  });

  console.log(`📋 Индекс создан: ${Object.keys(earliestLeadByContact).length} контактов`);

  // 2. БЫСТРОЕ СВЯЗЫВАНИЕ
  const linkedSales = sales.map(sale => {
    const contactId = sale.CONTACT_ID;
    const earliestLead = contactId ? earliestLeadByContact[contactId] : null;
    
    if (earliestLead) {
      return {
        ...sale,
        amount: parseFloat(sale.OPPORTUNITY || 0),
        sourceId: earliestLead.SOURCE_ID || 'UNKNOWN',
        sourceName: earliestLead.SOURCE_NAME || 'Неизвестный источник',
        linkMethod: 'CONTACT_ID',
        linkedLeadId: earliestLead.ID
      };
    } else {
      return {
        ...sale,
        amount: parseFloat(sale.OPPORTUNITY || 0),
        sourceId: 'UNKNOWN',
        sourceName: 'Неизвестный источник',
        linkMethod: contactId ? 'NO_LEADS_FOUND' : 'NO_CONTACT'
      };
    }
  });

  // 3. БЫСТРАЯ СТАТИСТИКА
  const linked = linkedSales.filter(s => s.sourceId !== 'UNKNOWN').length;
  const successRate = sales.length > 0 ? Math.round((linked / sales.length) * 100) : 0;
  
  console.log(`📊 Связано: ${linked}/${sales.length} (${successRate}%)`);

  return {
    sales: linkedSales,
    stats: {
      successRate: successRate,
      totalLinked: linked,
      byMethod: { 'CONTACT_ID': linked }
    }
  };
}*/

/**
 * НОВАЯ ФУНКЦИЯ - ЗАГРУЗКА ЛИДОВ ПО СПИСКУ CONTACT_ID
 */
async function getLeadsByContactIds(contactIds) {
  try {
    console.log(`🔍 Загружаем лиды для ${contactIds.length} контактов`);
    
    const allLeads = [];
    const batchSize = 50; // Битрикс ограничивает фильтры
    
    // Обрабатываем контакты батчами
    for (let i = 0; i < contactIds.length; i += batchSize) {
      const batch = contactIds.slice(i, i + batchSize);
      console.log(`📦 Обрабатываем батч ${Math.floor(i/batchSize) + 1}: контакты ${i + 1}-${Math.min(i + batchSize, contactIds.length)}`);
      
      // Для каждого контакта ищем его лиды
      const batchPromises = batch.map(async (contactId) => {
        const contactLeads = await getLeads({
          'CONTACT_ID': contactId
        });
        return contactLeads || [];
      });
      
      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(leads => allLeads.push(...leads));
    }
    
    console.log(`✅ Загружено ${allLeads.length} лидов для ${contactIds.length} контактов`);
    return allLeads;
    
  } catch (error) {
    console.error('❌ Ошибка загрузки лидов по контактам:', error);
    return [];
  }
}

/**
 * ОПТИМИЗИРОВАННАЯ ФУНКЦИЯ СВЯЗЫВАНИЯ С ДАТАМИ И ЦИКЛОМ СДЕЛКИ
 */
async function linkSalesToSourcesOptimized(sales, leads) {
  console.log(`🔗 ОПТИМИЗИРОВАННОЕ связывание ${sales.length} продаж с ${leads.length} лидами`);
  
  // Обогащаем только найденные лиды (намного быстрее!)
  const enrichedLeads = await enrichLeadsWithSourceNames(leads);
  
  // 1. БЫСТРЫЙ ИНДЕКС ЛИДОВ ПО CONTACT_ID (только самый ранний лид каждого контакта)
  const earliestLeadByContact = {};
  
  enrichedLeads.forEach(lead => {
    if (lead.CONTACT_ID) {
      const existing = earliestLeadByContact[lead.CONTACT_ID];
      if (!existing || new Date(lead.DATE_CREATE) < new Date(existing.DATE_CREATE)) {
        earliestLeadByContact[lead.CONTACT_ID] = lead;
      }
    }
  });
  
  console.log(`📋 Индекс создан: ${Object.keys(earliestLeadByContact).length} контактов`);

  // 2. ФУНКЦИЯ РАСЧЕТА ЦИКЛА СДЕЛКИ
  const calculateDealCycle = (leadDate, saleDate) => {
    if (!leadDate || !saleDate) return null;
    
    const lead = new Date(leadDate);
    const sale = new Date(saleDate);
    const diffMs = sale - lead;
    
    if (diffMs < 0) return "Ошибка дат";
    
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (diffDays === 0) {
      if (diffHours === 0) {
        const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        return `${diffMinutes} мин`;
      }
      return `${diffHours} ч`;
    }
    
    if (diffDays < 30) {
      return `${diffDays} дн`;
    }
    
    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths} мес`;
  };

  // 3. ФОРМАТИРОВАНИЕ ДАТЫ ДЛЯ ОТОБРАЖЕНИЯ
  const formatDisplayDate = (dateString) => {
    if (!dateString) return "Нет данных";
    
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    } catch (error) {
      return "Некорректная дата";
    }
  };

  // 4. БЫСТРОЕ СВЯЗЫВАНИЕ С РАСЧЕТОМ ДАТ И ЦИКЛА
  const linkedSales = sales.map(sale => {
    const contactId = sale.CONTACT_ID;
    const earliestLead = contactId ? earliestLeadByContact[contactId] : null;
    
    if (earliestLead) {
      const leadDate = earliestLead.DATE_CREATE;
      const saleDate = sale.DATE_CREATE;
      const dealCycle = calculateDealCycle(leadDate, saleDate);
      
      return {
        ...sale,
        amount: parseFloat(sale.OPPORTUNITY || 0),
        sourceId: earliestLead.SOURCE_ID || 'UNKNOWN',
        sourceName: earliestLead.SOURCE_NAME || 'Неизвестный источник',
        linkMethod: 'CONTACT_ID',
        linkedLeadId: earliestLead.ID,
        // НОВЫЕ ПОЛЯ ДЛЯ ТАБЛИЦЫ
        leadDate: leadDate,
        leadDateFormatted: formatDisplayDate(leadDate),
        saleDate: saleDate,
        saleDateFormatted: formatDisplayDate(saleDate),
        dealCycle: dealCycle,
        dealCycleDays: leadDate && saleDate ? Math.floor((new Date(saleDate) - new Date(leadDate)) / (1000 * 60 * 60 * 24)) : null
      };
    } else {
      return {
        ...sale,
        amount: parseFloat(sale.OPPORTUNITY || 0),
        sourceId: 'UNKNOWN',
        sourceName: 'Неизвестный источник',
        linkMethod: contactId ? 'NO_LEADS_FOUND' : 'NO_CONTACT',
        // ПОЛЯ ДЛЯ НЕИЗВЕСТНЫХ ИСТОЧНИКОВ
        leadDate: null,
        leadDateFormatted: "Лид не найден",
        saleDate: sale.DATE_CREATE,
        saleDateFormatted: formatDisplayDate(sale.DATE_CREATE),
        dealCycle: "Нет данных",
        dealCycleDays: null
      };
    }
  });

  // 5. БЫСТРАЯ СТАТИСТИКА + СТАТИСТИКА ПО ЦИКЛАМ
  const linked = linkedSales.filter(s => s.sourceId !== 'UNKNOWN').length;
  const successRate = sales.length > 0 ? Math.round((linked / sales.length) * 100) : 0;
  
  // Статистика по циклам сделок
  const cyclesWithData = linkedSales.filter(s => s.dealCycleDays !== null);
  const avgCycleDays = cyclesWithData.length > 0 
    ? Math.round(cyclesWithData.reduce((sum, s) => sum + s.dealCycleDays, 0) / cyclesWithData.length)
    : null;
  
  const minCycleDays = cyclesWithData.length > 0 
    ? Math.min(...cyclesWithData.map(s => s.dealCycleDays))
    : null;
    
  const maxCycleDays = cyclesWithData.length > 0 
    ? Math.max(...cyclesWithData.map(s => s.dealCycleDays))
    : null;
  
  console.log(`📊 ОПТИМИЗИРОВАННОЕ связывание завершено: ${linked}/${sales.length} (${successRate}%)`);
  console.log(`⏱️ Средний цикл сделки: ${avgCycleDays} дней (мин: ${minCycleDays}, макс: ${maxCycleDays})`);
  
  return {
    sales: linkedSales,
    stats: {
      successRate: successRate,
      totalLinked: linked,
      byMethod: { 'CONTACT_ID': linked },
      // НОВАЯ СТАТИСТИКА ПО ЦИКЛАМ
      dealCycleStats: {
        avgDays: avgCycleDays,
        minDays: minCycleDays,
        maxDays: maxCycleDays,
        salesWithCycleData: cyclesWithData.length
      }
    }
  };
}

/**
 * ОПТИМИЗИРОВАННАЯ ФУНКЦИЯ АНАЛИТИКИ ПРОДАЖ
 * Вместо загрузки 1700+ лидов загружаем только нужные
 */
async function getSalesAnalytics(filters = {}) {
  try {
    console.log('💰 НАЧИНАЕМ ОПТИМИЗИРОВАННУЮ АНАЛИТИКУ ПРОДАЖ');

    // 1. ПОЛУЧАЕМ ПРОДАЖИ (успешные сделки) ИЗ ВОРОНКИ "ДОГОВОР"
    console.log('🔍 Запрос продаж: воронка 31, стадия C31:WON');
    const salesDeals = await getDeals({
      'CATEGORY_ID': '31',     // Воронка "Договор"
      'STAGE_ID': 'C31:WON',  // Стадия "Внесена предоплата" = ПРОДАЖА
      '>=DATE_CREATE': filters.startDate || '2025-06-01T00:00:00',
      '<=DATE_CREATE': filters.endDate || '2025-06-11T23:59:59'
    });

    console.log(`💰 Найдено продаж: ${salesDeals ? salesDeals.length : 0}`);

    if (!salesDeals || salesDeals.length === 0) {
      return {
        success: true,
        data: [],
        totals: { totalSales: 0, totalAmount: 0, averageAmount: 0 },
        debug: { salesFound: 0, linkedSales: 0, unknownSales: 0 }
      };
    }

    // 2. СОБИРАЕМ УНИКАЛЬНЫЕ CONTACT_ID ИЗ ПРОДАЖ
    const uniqueContactIds = [...new Set(
      salesDeals
        .map(sale => sale.CONTACT_ID)
        .filter(id => id && id !== '0')
    )];
    
    console.log(`👥 Уникальных контактов в продажах: ${uniqueContactIds.length}`);

    // 3. ЗАГРУЖАЕМ ТОЛЬКО ЛИДЫ ЭТИХ КОНТАКТОВ (НАМНОГО БЫСТРЕЕ!)
    let contactLeads = [];
    if (uniqueContactIds.length > 0) {
      console.log('📋 Получаем лиды только для контактов с продажами...');
      
      // Запрашиваем лиды конкретных контактов
      contactLeads = await getLeadsByContactIds(uniqueContactIds);
      console.log(`📋 Найдено лидов для связывания: ${contactLeads.length}`);
    }

    // 4. СВЯЗЫВАЕМ ПРОДАЖИ С ИСТОЧНИКАМИ (БЫСТРО!)
    const linkingResult = await linkSalesToSourcesOptimized(salesDeals, contactLeads);
    const salesWithSources = linkingResult.sales;
    const linkingStats = linkingResult.stats;

    // 5. ГРУППИРУЕМ ПО ИСТОЧНИКАМ
    const salesBySource = {};

    salesWithSources.forEach(sale => {
      const sourceId = sale.sourceId || 'UNKNOWN';

      if (!salesBySource[sourceId]) {
        salesBySource[sourceId] = {
          sourceId: sourceId,
          sourceName: sale.sourceName || 'Неизвестный источник',
          sales: [],
          totalSales: 0,
          totalAmount: 0,
          averageAmount: 0
        };
      }

      salesBySource[sourceId].sales.push(sale);
      salesBySource[sourceId].totalSales++;
      salesBySource[sourceId].totalAmount += parseFloat(sale.amount || 0);
    });

    // 6. ВЫЧИСЛЯЕМ СРЕДНИЙ ЧЕК
    Object.values(salesBySource).forEach(source => {
      source.averageAmount = source.totalSales > 0 ? 
        Math.round(source.totalAmount / source.totalSales) : 0;
    });

    // 7. СОРТИРУЕМ ПО КОЛИЧЕСТВУ ПРОДАЖ
    const sortedSources = Object.values(salesBySource)
      .sort((a, b) => b.totalSales - a.totalSales);

    const totalAmount = salesWithSources.reduce((sum, sale) => sum + parseFloat(sale.amount || 0), 0);

    console.log('💰 ОПТИМИЗИРОВАННАЯ АНАЛИТИКА ПРОДАЖ ЗАВЕРШЕНА');
    console.log(`📊 Статистика связывания: ${linkingStats.successRate}%`);

    return {
      success: true,
      data: sortedSources,
      totals: {
        totalSales: salesDeals.length,
        totalAmount: Math.round(totalAmount),
        averageAmount: salesDeals.length > 0 ? Math.round(totalAmount / salesDeals.length) : 0,
        linkingSuccessRate: linkingStats.successRate
      },
      debug: {
        salesFound: salesDeals.length,
        uniqueContacts: uniqueContactIds.length,
        leadsFound: contactLeads.length,
        linkedSales: salesWithSources.filter(s => s.sourceId !== 'UNKNOWN').length,
        unknownSales: salesWithSources.filter(s => s.sourceId === 'UNKNOWN').length,
        linkingStats: linkingStats,
        salesBreakdown: sortedSources.slice(0, 5).map(s => ({
          source: s.sourceName,
          sales: s.totalSales,
          amount: s.totalAmount
        }))
      }
    };

  } catch (error) {
    console.error('❌ Ошибка аналитики продаж:', error);
    return {
      success: false,
      error: error.message,
      data: []
    };
  }
}


// Экспорт ВСЕХ функций включая исправленную getLeads
module.exports = {
  bitrixRequest,
  getLeadSources,
  getSources,         // Для совместимости
  getLeads,           // ← ИСПРАВЛЕННАЯ ФУНКЦИЯ С ПРАВИЛЬНОЙ ПАГИНАЦИЕЙ
  getLeadStages,
  getLead,
  updateLead,
  getDealsByLead,
  getDealsByContact,  
  getDeals,           // ← ТАКЖЕ ИСПРАВЛЕНА ПАГИНАЦИЯ
  //getDealCategories,  
  getCustomFields,
  enrichLeadsWithSourceNames,
  getUsers,
  getSalesAnalytics,
  //extractClientName,
  //normalizeClientName,
  //linkSalesToSources,
  getLeadsByContactIds,
  linkSalesToSourcesOptimized
};
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
async function getDealCategories() {
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
}

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
    
    const params = {
      select: [
        'ID',
        'NAME', 
        'LAST_NAME',
        'EMAIL',
        'ACTIVE',
        'WORK_POSITION',
        'UF_DEPARTMENT'
      ]
      // Убираем фильтр ACTIVE - получаем всех пользователей
    };
    
    console.log('🔍 Параметры запроса пользователей:', params);
    
    // ИСПРАВЛЕНО: bitrixRequest вместо makeRequest
    const response = await bitrixRequest('user.get', params);
    
    if (response && response.result) {
      console.log(`✅ Получено пользователей: ${response.result.length}`);
      console.log('👥 Примеры пользователей:', response.result.slice(0, 3).map(user => ({
        id: user.ID,
        name: `${user.NAME} ${user.LAST_NAME}`.trim(),
        position: user.WORK_POSITION,
        active: user.ACTIVE
      })));
      
      return response.result;
    }
    
    console.warn('⚠️ Нет данных о пользователях в ответе Bitrix24');
    return [];
    
  } catch (error) {
    console.error('❌ Ошибка получения пользователей из Bitrix24:', error);
    return [];
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
  getDealCategories,  
  getCustomFields,
  enrichLeadsWithSourceNames,
  getUsers
};
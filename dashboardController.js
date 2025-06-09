// controllers/dashboardController.js - ФИНАЛЬНАЯ исправленная версия с простой логикой отложенных конверсий
const LeadSource = require('../models/LeadSource');
const bitrixService = require('../bitrix/bitrixService');
const { format, parseISO, isValid } = require('date-fns');

// ТОЧНАЯ конфигурация стадий согласно API Bitrix24
const STAGE_CONFIG = {
  // Рабочие стадии
  new: {
    statuses: ['2'],
    name: 'Не обработан',
    type: 'working'
  },
  distributed: {
    statuses: ['NEW'],
    name: 'Распределен', 
    type: 'working'
  },
  inWork: {
    statuses: ['4'],
    name: 'В работе',
    type: 'working'
  },
  communication: {
    statuses: ['UC_WFIWVS'],
    name: 'Коммуникация установлена',
    type: 'working'
  },
  noResponse: {
    statuses: ['UC_OMBROC'],
    name: 'Не отвечает',
    type: 'working'
  },
  longNoCall: {
    statuses: ['UC_VKCFXM'],
    name: 'Длительный недозвон',
    type: 'working'
  },
  qualified: {
    statuses: ['6'],
    name: 'Квалификация проведена',
    type: 'working'
  },
  
  // Встречи - ТОЧНЫЕ ID!
  meetingsScheduled: {
    statuses: ['UC_AD2OF7'],
    name: 'Встреча назначена',
    type: 'meeting'
  },
  meetingsFailed: {
    statuses: ['UC_25C0T2'],
    name: 'Несостоявшаяся встреча',
    type: 'working'
  },
  
  // Успешные встречи
  converted: {
    statuses: ['CONVERTED'],
    name: 'Обработка лида завершена',
    type: 'success'
  },
  
  // ВСЕ виды брака с ТОЧНЫМИ ID из вашего списка
  junk: {
    statuses: [
      'JUNK',                    // Старье до 01.12.2022
      '11',                      // Не договорились
      '10',                      // Несписываемые долги
      '9',                       // Клиент заблокировал чат
      '8',                       // Работает с конкурентами
      '5',                       // Риск потери имущества (не ипотека)
      'UC_GQ2A1A',              // Уже не надо
      'UC_32WMCS',              // Реклама/спам
      'UC_XSGR98',              // Долг менее 250 т.р.
      'UC_NN9P5K',              // Номер недоступен/не существует
      'UC_T7LX9V',              // Не отвечает/Длительный недозвон
      'UC_C175EE',              // Не оставляли заявку
      'UC_DFO4SC'               // Дубль
    ],
    name: 'Брак',
    type: 'junk'
  }
};

// Создаем обратный маппинг: статус -> конфигурация
const STATUS_TO_STAGE = {};
Object.keys(STAGE_CONFIG).forEach(stageKey => {
  const stage = STAGE_CONFIG[stageKey];
  stage.statuses.forEach(status => {
    STATUS_TO_STAGE[status] = {
      key: stageKey,
      ...stage
    };
  });
});

/**
 * ИСПРАВЛЕННАЯ функция получения дат с учетом московского времени и поддержкой всех периодов
 */
function getPeriodDates(period, startDate, endDate) {
  const now = new Date();
  
  // HOTFIX: Обработка проблемных запросов от фронтенда
  console.log(`🔧 ПОЛУЧЕН ЗАПРОС: period="${period}", startDate="${startDate}", endDate="${endDate}"`);
  
  // Функция для создания даты в московском времени
  function toMoscowDateTime(dateString, isEndOfDay = false) {
    const date = new Date(dateString);
    if (isEndOfDay) {
      date.setHours(23, 59, 59, 999);
    } else {
      date.setHours(0, 0, 0, 0);
    }
    
    // Форматируем как ISO строку с явным указанием времени
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
  }
  
  let start, end;
  
  switch (period) {
    case 'today':
      start = toMoscowDateTime(now.toISOString().split('T')[0]);
      end = toMoscowDateTime(now.toISOString().split('T')[0], true);
      break;
      
    case 'yesterday':
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      start = toMoscowDateTime(yesterday.toISOString().split('T')[0]);
      end = toMoscowDateTime(yesterday.toISOString().split('T')[0], true);
      break;
      
    case 'week':
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay() + 1); // Понедельник
      start = toMoscowDateTime(startOfWeek.toISOString().split('T')[0]);
      end = toMoscowDateTime(now.toISOString().split('T')[0], true);
      break;
      
    case 'month':
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      start = toMoscowDateTime(startOfMonth.toISOString().split('T')[0]);
      end = toMoscowDateTime(now.toISOString().split('T')[0], true);
      break;
      
    case 'quarter':
      const currentQuarter = Math.floor(now.getMonth() / 3);
      const quarterStart = new Date(now.getFullYear(), currentQuarter * 3, 1);
      start = toMoscowDateTime(quarterStart.toISOString().split('T')[0]);
      end = toMoscowDateTime(now.toISOString().split('T')[0], true);
      break;
      
    case 'custom':
      if (!startDate || !endDate) {
        console.log('🔧 HOTFIX: period=custom без дат, используем последние 7 дней');
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - 7);
        start = toMoscowDateTime(weekStart.toISOString().split('T')[0]);
        end = toMoscowDateTime(now.toISOString().split('T')[0], true);
      } else {
        start = toMoscowDateTime(startDate);
        end = toMoscowDateTime(endDate, true);
      }
      break;
      
    default:
      // Fallback для любых других случаев
      console.log(`🔧 HOTFIX: Неизвестный период "${period}", используем week`);
      const defaultWeekStart = new Date(now);
      defaultWeekStart.setDate(now.getDate() - now.getDay() + 1);
      start = toMoscowDateTime(defaultWeekStart.toISOString().split('T')[0]);
      end = toMoscowDateTime(now.toISOString().split('T')[0], true);
  }
  
  console.log(`📅 Итоговый период "${period}": ${start} — ${end}`);
  
  return { start, end };
}

/**
 * 🎯 ПРОСТАЯ И ГЕНИАЛЬНАЯ ЛОГИКА ОТЛОЖЕННЫХ КОНВЕРСИЙ
 */
function analyzeConversions(leads, deals, sourceId = null) {
  console.log(`🎯 АНАЛИЗ КОНВЕРСИЙ: ${leads.length} лидов, ${deals.length} сделок`);
  
  // Создаем Set для быстрого поиска лидов в периоде
  const leadsInPeriodSet = new Set(leads.map(lead => lead.ID));
  
  const result = {
    // Основные конверсии
    basicMeetings: 0,
    basicScheduled: 0,
    
    // Отложенные конверсии  
    delayedMeetings: 0,
    delayedScheduled: 0,
    
    // Детализация
    basicDetails: [],
    delayedDetails: [],
    
    // По источникам
    bySource: {}
  };
  
  // Анализируем каждую сделку
  deals.forEach(deal => {
    const leadId = deal.LEAD_ID;
    if (!leadId) return;
    
    // 🎯 КЛЮЧЕВАЯ ЛОГИКА: проверяем, есть ли лид в нашем периоде
    const isBasicConversion = leadsInPeriodSet.has(leadId);
    
    // Определяем тип встречи (назначенная/состоявшаяся)
    const isScheduled = isScheduledMeeting(deal);
    
    if (isBasicConversion) {
      // ✅ ОСНОВНАЯ КОНВЕРСИЯ: лид создан в периоде
      if (isScheduled) {
        result.basicScheduled++;
      } else {
        result.basicMeetings++;
      }
      
      result.basicDetails.push({
        leadId,
        dealId: deal.ID,
        dealTitle: deal.TITLE,
        dealDate: deal.DATE_CREATE,
        type: isScheduled ? 'scheduled' : 'meeting',
        category: 'basic'
      });
      
    } else {
      // 🔄 ОТЛОЖЕННАЯ КОНВЕРСИЯ: лид создан ДО периода
      if (isScheduled) {
        result.delayedScheduled++;
      } else {
        result.delayedMeetings++;
      }
      
      result.delayedDetails.push({
        leadId,
        dealId: deal.ID,
        dealTitle: deal.TITLE,
        dealDate: deal.DATE_CREATE,
        type: isScheduled ? 'scheduled' : 'meeting',
        category: 'delayed'
      });
    }
  });
  
  console.log(`✅ РЕЗУЛЬТАТ АНАЛИЗА КОНВЕРСИЙ:`);
  console.log(`  📈 Основные: ${result.basicMeetings} встреч + ${result.basicScheduled} назначений`);
  console.log(`  🔄 Отложенные: ${result.delayedMeetings} встреч + ${result.delayedScheduled} назначений`);
  
  return result;
}

/**
 * 🎯 ОПРЕДЕЛЕНИЕ ТИПА ВСТРЕЧИ
 */
function isScheduledMeeting(deal) {
  // Логика определения назначенной vs состоявшейся встречи
  const title = (deal.TITLE || '').toLowerCase();
  
  // Ключевые слова для назначенной встречи
  const scheduledKeywords = ['назначена', 'запланирована', 'встреча назначена'];
  const isScheduledByTitle = scheduledKeywords.some(keyword => title.includes(keyword));
  
  // Можно также использовать категорию или статус
  const isScheduledByStatus = deal.CATEGORY_ID === 'SCHEDULED' || deal.STATUS_ID === 'SCHEDULED';
  
  return isScheduledByTitle || isScheduledByStatus;
}

/**
 * 🛠️ ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ: подсчет статусов лидов
 */
function countLeadStatuses(sourceLeads) {
  const statusCounts = {
    communication: 0,
    qualified: 0,
    junk: 0,
    under250k: 0,
    meetingsScheduledStatus: 0
  };
  
  sourceLeads.forEach(lead => {
    const status = lead.STATUS_ID;
    switch(status) {
      case 'UC_WFIWVS':  // Коммуникация установлена
      case 'UC_OMBROC':  // Не отвечает
      case 'UC_VKCFXM':  // Длительный недозвон
        statusCounts.communication++;
        break;
      case '6':          // Квалификация проведена
      case 'CONVERTED':  // Обработка лида завершена
        statusCounts.qualified++;
        break;
      case 'UC_AD2OF7':  // Встреча назначена
        statusCounts.meetingsScheduledStatus++;
        break;
      case 'JUNK':
      case '11':
      case '10':
      case '9':
      case '8':
      case '5':
      case 'UC_GQ2A1A':
      case 'UC_32WMCS':
      case 'UC_XSGR98':
      case 'UC_NN9P5K':
      case 'UC_T7LX9V':
      case 'UC_C175EE':
      case 'UC_DFO4SC':
        statusCounts.junk++;
        break;
      default:
        if (status && status.includes('UC_')) {
          console.log(`⚠️ Неизвестный статус лида: ${status}`);
        }
        break;
    }
  });
  
  return statusCounts;
}

/**
 * Получение источников лидов
 */
async function getSources(req, res) {
  try {
    console.log('📊 Запрос источников лидов');
    
    const sources = await LeadSource.find({}).sort({ name: 1 });
    console.log(`✅ Найдено источников: ${sources.length}`);
    
    res.json({
      success: true,
      data: sources,
      total: sources.length
    });
  } catch (error) {
    console.error('❌ Ошибка получения источников:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения источников лидов'
    });
  }
}

/**
 * Синхронизация источников с Bitrix24
 */
async function syncSources(req, res) {
  try {
    console.log('🔄 Начинаем синхронизацию источников с Bitrix24');
    
    // Получаем источники из Bitrix24
    const bitrixSources = await bitrixService.getSources();
    console.log(`📥 Получено источников из Bitrix24: ${bitrixSources.length}`);
    
    let syncedCount = 0;
    let updatedCount = 0;
    
    for (const source of bitrixSources) {
      try {
        const existingSource = await LeadSource.findOne({ 
          bitrixId: source.ID 
        });
        
        if (existingSource) {
          // Обновляем существующий
          existingSource.name = source.NAME || `Источник ${source.ID}`;
          existingSource.lastSync = new Date();
          await existingSource.save();
          updatedCount++;
        } else {
          // Создаем новый
          await LeadSource.create({
            bitrixId: source.ID,
            name: source.NAME || `Источник ${source.ID}`,
            isActive: true,
            lastSync: new Date()
          });
          syncedCount++;
        }
      } catch (itemError) {
        console.error(`❌ Ошибка синхронизации источника ${source.ID}:`, itemError);
      }
    }
    
    console.log(`✅ Синхронизация завершена: ${syncedCount} новых, ${updatedCount} обновлено`);
    
    res.json({
      success: true,
      message: `Синхронизация завершена: ${syncedCount} новых источников, ${updatedCount} обновлено`,
      synced: syncedCount,
      updated: updatedCount,
      total: bitrixSources.length
    });
    
  } catch (error) {
    console.error('❌ Ошибка синхронизации источников:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка синхронизации источников'
    });
  }
}

/**
 * ТОЧНАЯ функция анализа стадий лидов
 */
function analyzeLeadStage(lead) {
  const statusId = lead.STATUS_ID;
  const stageInfo = STATUS_TO_STAGE[statusId];
  
  if (!stageInfo) {
    console.warn(`⚠️ Неизвестный статус лида: ${statusId}`);
    return {
      key: 'unknown',
      name: `Неизвестный статус: ${statusId}`,
      type: 'working'
    };
  }
  
  return stageInfo;
}

/**
 * ТОЧНЫЙ подсчет стадий с правильными статусами
 */
function calculateStageAnalysis(leads) {
  const analysis = {
    new: 0,
    distributed: 0,
    inWork: 0,
    communication: 0,
    noResponse: 0,
    longNoCall: 0,
    qualified: 0,
    meetingsScheduled: 0,
    meetingsFailed: 0,
    converted: 0,
    junk: 0
  };
  
  console.log('\n🔍 Детальный анализ стадий лидов:');
  
  leads.forEach(lead => {
    const stage = analyzeLeadStage(lead);
    if (analysis.hasOwnProperty(stage.key)) {
      analysis[stage.key]++;
      console.log(`  Лид ${lead.ID}: статус "${lead.STATUS_ID}" → стадия "${stage.key}" (${stage.name})`);
    } else {
      console.log(`  Лид ${lead.ID}: статус "${lead.STATUS_ID}" → неизвестная стадия "${stage.key}"`);
    }
  });
  
  console.log('\n📊 Итоговая статистика по стадиям:');
  Object.keys(analysis).forEach(key => {
    if (analysis[key] > 0) {
      console.log(`  ${key}: ${analysis[key]} лидов`);
    }
  });
  
  return analysis;
}

/**
 * Получение аналитики лидов с ПРОСТОЙ логикой отложенных конверсий
 */
async function getLeadsAnalytics(req, res) {
  try {
    const startTime = Date.now();
    console.log('📊 Запрос аналитики лидов с ПРОСТОЙ логикой отложенных конверсий');
    
    // Получаем параметры
    const { period = 'week', sourceId, startDate, endDate } = req.query;
    
    console.log('🔍 Входящие параметры:', { period, sourceId, startDate, endDate });
    
    // Определяем период с учетом московского времени
    const dateRange = getPeriodDates(period, startDate, endDate);
    
    console.log(`📅 Период анализа: ${dateRange.start} - ${dateRange.end}`);
    
    // Формируем фильтры для Bitrix24 с московским временем
    const filters = {
      '>=DATE_CREATE': dateRange.start,
      '<=DATE_CREATE': dateRange.end
    };
    
    // Добавляем фильтр по источнику если указан
    if (sourceId && sourceId !== 'all') {
      filters['SOURCE_ID'] = sourceId;
    }
    
    console.log('🔍 Фильтры для Bitrix24 с московским временем:', filters);
    
    // Получаем лиды из Bitrix24 для выбранного периода
    const leads = await bitrixService.getLeads(filters);
    console.log(`📥 Получено лидов за период: ${leads.length}`);
    
    // Получаем сделки для выбранного периода
    const deals = await bitrixService.getDeals({
      '>=DATE_CREATE': dateRange.start,
      '<=DATE_CREATE': dateRange.end,
      'CATEGORY_ID': '31'
    });
    console.log(`📥 Получено сделок за период: ${deals.length}`);
    
    // 🎯 ПРОСТОЙ АНАЛИЗ КОНВЕРСИЙ
    const conversions = analyzeConversions(leads, deals, sourceId);
    
    // ДОБАВЛЯЕМ ЛОГИРОВАНИЕ ДЛЯ ОТЛАДКИ
    console.log('🔍 Проверка SOURCE_ID в лидах:');
    const sourceStats = {};
    leads.forEach(lead => {
      const sourceIdLead = lead.SOURCE_ID || 'NO_SOURCE';
      sourceStats[sourceIdLead] = (sourceStats[sourceIdLead] || 0) + 1;
    });
    console.log('📊 Распределение по источникам:', sourceStats);
    console.log(`❓ Лидов без источника: ${sourceStats['NO_SOURCE'] || 0}`);
    
    if (leads.length === 0) {
      return res.json({
        success: true,
        data: [],
        period: dateRange,
        totalLeads: 0,
        totalMeetingsHeld: 0,
        totalMeetingsFromDatabase: 0,
        totalScheduledFromDatabase: 0,
        note: 'Лиды не найдены за указанный период'
      });
    }
    
    // Группируем лиды по источникам (ИСПРАВЛЕНО)
    const leadsBySource = groupLeadsBySource(leads);
    console.log(`📊 Источников с лидами: ${Object.keys(leadsBySource).length}`);
    
    // ПРОВЕРКА ЦЕЛОСТНОСТИ ДАННЫХ
    const totalLeadsCheck = Object.values(leadsBySource).reduce((sum, leads) => sum + leads.length, 0);
    console.log(`✅ Проверка: получено ${leads.length} лидов, сгруппировано ${totalLeadsCheck} лидов`);
    if (leads.length !== totalLeadsCheck) {
      console.error(`❌ ПОТЕРЯ ДАННЫХ: ${leads.length - totalLeadsCheck} лидов потеряно при группировке!`);
    }
    
    // Анализируем каждый источник
    const sourceAnalytics = [];
    
    // ИСПРАВЛЕНО: считаем totalLeads просто как длину массива!
    const totalLeads = leads.length;
    let totalMeetingsHeld = 0;
    
    // Фильтрация по источнику
    let filteredSources = Object.keys(leadsBySource);
    if (sourceId && sourceId !== 'all') {
      const requestedSources = sourceId.split(',');
      filteredSources = filteredSources.filter(id => requestedSources.includes(id));
    }
    
    for (const [currentSourceId, sourceLeads] of Object.entries(leadsBySource)) {
      if (!filteredSources.includes(currentSourceId)) continue;
      
      console.log(`\n📊 Анализ источника ${currentSourceId}: ${sourceLeads.length} лидов`);
      
      // Подсчеты статусов
      const statusCounts = countLeadStatuses(sourceLeads);
      
      // Основные встречи (только для лидов в периоде)
      const meetingsHeld = countMeetingsFromDeals(sourceLeads, deals);
      
      // ИСПРАВЛЕННАЯ логика назначенных встреч
      const meetingsScheduledTotal = statusCounts.meetingsScheduledStatus + meetingsHeld;
      
      // Конверсия из назначенной в состоявшуюся
      const meetingsHeldFromScheduledConversion = meetingsScheduledTotal > 0 
        ? ((meetingsHeld / meetingsScheduledTotal) * 100).toFixed(1)
        : '0.0';
      
      // 🎯 ПРОСТЫЕ отложенные конверсии для источника
      // Пропорциональное распределение общих отложенных конверсий
      const sourcePercentage = sourceLeads.length / leads.length;
      const meetingsFromDatabase = Math.round(conversions.delayedMeetings * sourcePercentage);
      const scheduledFromDatabase = Math.round(conversions.delayedScheduled * sourcePercentage);
      
      totalMeetingsHeld += meetingsHeld;
      
      const analytics = {
        sourceId: currentSourceId,
        sourceName: `Источник ${currentSourceId}`,
        totalLeads: sourceLeads.length,
        
        // Основные метрики
        comments: statusCounts.communication,
        commentsConversion: sourceLeads.length > 0 ? ((statusCounts.communication / sourceLeads.length) * 100).toFixed(1) : '0.0',
        
        qualified: statusCounts.qualified,
        qualifiedConversion: sourceLeads.length > 0 ? ((statusCounts.qualified / sourceLeads.length) * 100).toFixed(1) : '0.0',
        
        // ИСПРАВЛЕННЫЕ встречи
        meetingsScheduled: meetingsScheduledTotal,
        meetingsScheduledConversion: sourceLeads.length > 0 ? ((meetingsScheduledTotal / sourceLeads.length) * 100).toFixed(1) : '0.0',
        
        meetingsHeld,
        meetingsHeldConversion: sourceLeads.length > 0 ? ((meetingsHeld / sourceLeads.length) * 100).toFixed(1) : '0.0',
        
        // НОВАЯ метрика
        meetingsHeldFromScheduledConversion,
        
        // 🎯 ПРОСТЫЕ отложенные конверсии
        meetingsFromDatabase,
        scheduledFromDatabase,
        
        junk: statusCounts.junk,
        junkPercent: sourceLeads.length > 0 ? ((statusCounts.junk / sourceLeads.length) * 100).toFixed(1) : '0.0',
        
        under250k: sourceLeads.length, // Пока все лиды считаем как до 250к
        under250kPercent: '100.0',
        
        stageAnalysis: {
          new: sourceLeads.length - statusCounts.communication - statusCounts.qualified - statusCounts.junk,
          qualified: statusCounts.qualified,
          converted: statusCounts.qualified,
          communication: statusCounts.communication,
          meetingsScheduled: statusCounts.meetingsScheduledStatus,
          junk: statusCounts.junk
        }
      };
      
      sourceAnalytics.push(analytics);
      console.log(`✅ Источник ${currentSourceId}: ${sourceLeads.length} лидов, ${meetingsHeld} встреч, ${meetingsFromDatabase} из базы`);
    }
    
    const processingTime = Date.now() - startTime;
    
    console.log(`\n🎯 ИТОГОВАЯ СТАТИСТИКА (ПРОСТАЯ ЛОГИКА):`);
    console.log(`📊 Всего источников: ${sourceAnalytics.length}`);
    console.log(`📈 Всего лидов: ${totalLeads}`);
    console.log(`🤝 Всего встреч: ${totalMeetingsHeld}`);
    console.log(`🔄 Отложенных встреч: ${conversions.delayedMeetings}`);
    console.log(`📅 Отложенных назначений: ${conversions.delayedScheduled}`);
    console.log(`⚡ Время обработки: ${processingTime}ms`);
    
    res.json({
      success: true,
      data: sourceAnalytics,
      period: dateRange,
      totalLeads,
      totalMeetingsHeld,
      
      // 🎯 ПРОСТЫЕ отложенные конверсии
      totalMeetingsFromDatabase: conversions.delayedMeetings,
      totalScheduledFromDatabase: conversions.delayedScheduled,
      
      processingTime,
      note: `Анализ ${totalLeads} лидов из ${sourceAnalytics.length} источников с простой логикой отложенных конверсий`,
      debug: {
        filters,
        requestedSources: sourceId || 'all',
        actualPeriod: period,
        dateRange,
        
        // 🎯 ПРОСТАЯ детализация конверсий
        basicConversions: {
          meetings: conversions.basicMeetings,
          scheduled: conversions.basicScheduled,
          details: conversions.basicDetails.slice(0, 5)
        },
        delayedConversions: {
          meetings: conversions.delayedMeetings,
          scheduled: conversions.delayedScheduled,
          details: conversions.delayedDetails.slice(0, 5)
        },
        
        totalLeadsReceived: leads.length,
        totalLeadsCounted: totalLeads,
        leadsWithoutSource: sourceStats['NO_SOURCE'] || 0,
        sampleLeads: leads.slice(0, 3).map(lead => ({
          id: lead.ID,
          sourceId: lead.SOURCE_ID,
          statusId: lead.STATUS_ID,
          contactId: lead.CONTACT_ID
        })),
        meetingsBreakdown: sourceAnalytics.slice(0, 5).map(item => ({
          sourceName: item.sourceName,
          totalLeads: item.totalLeads,
          meetingsHeld: item.meetingsHeld,
          meetingsHeldConversion: item.meetingsHeldConversion,
          meetingsHeldFromScheduledConversion: item.meetingsHeldFromScheduledConversion,
          meetingsFromDatabase: item.meetingsFromDatabase,
          scheduledFromDatabase: item.scheduledFromDatabase
        }))
      }
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения аналитики лидов:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения аналитики лидов'
    });
  }
}

/**
 * Группировка лидов по источникам (ИСПРАВЛЕНО)
 */
function groupLeadsBySource(leads) {
  const grouped = {};
  
  leads.forEach(lead => {
    const sourceId = lead.SOURCE_ID || 'NO_SOURCE'; // ← ДОБАВЛЕНО значение по умолчанию!
    if (!grouped[sourceId]) {
      grouped[sourceId] = [];
    }
    grouped[sourceId].push(lead);
  });
  
  return grouped;
}

/**
 * Подсчет встреч через сделки в воронке "Договор"
 */
function countMeetingsFromDeals(leads, deals) {
  const leadIds = leads.map(lead => lead.ID);
  const leadIdsSet = new Set(leadIds);
  
  // Считаем сделки, связанные с нашими лидами
  const relevantDeals = deals.filter(deal => {
    const leadId = deal.LEAD_ID;
    return leadId && leadIdsSet.has(leadId);
  });
  
  console.log(`📊 ДЕТАЛИ СОСТОЯВШИХСЯ ВСТРЕЧ:`);
  relevantDeals.forEach((deal, index) => {
    console.log(`  Встреча ${index + 1}:`);
    console.log(`    Лид ID: ${deal.LEAD_ID}`);
    console.log(`    Сделка: ${deal.TITLE}`);
    console.log(`    Дата: ${deal.DATE_CREATE}`);
  });
  
  return relevantDeals.length;
}

/**
 * Получение стадий лидов с ТОЧНЫМИ статусами из API
 */
async function getLeadStages(req, res) {
  try {
    console.log('📊 Запрос стадий лидов');
    
    // Формируем полный список стадий из конфигурации с точными статусами
    const stages = {};
    
    Object.keys(STAGE_CONFIG).forEach(stageKey => {
      const stage = STAGE_CONFIG[stageKey];
      stage.statuses.forEach(status => {
        stages[status] = stage.name;
      });
    });
    
    console.log(`✅ Стадии подготовлены: ${Object.keys(stages).length}`);
    console.log('📋 Список всех статусов:');
    Object.keys(stages).forEach(statusId => {
      console.log(`  ${statusId}: ${stages[statusId]}`);
    });
    
    res.json({
      success: true,
      data: stages,
      total: Object.keys(stages).length,
      note: 'Статусы получены из точной конфигурации API Bitrix24'
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения стадий лидов:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения стадий лидов'
    });
  }
}

/**
 * Исправление ID источников в лидах
 */
async function fixSourceIds(req, res) {
  try {
    console.log('🔧 Начинаем исправление SOURCE_ID в лидах');
    
    // Получаем все лиды
    const leads = await bitrixService.getLeads({});
    console.log(`📥 Получено лидов для проверки: ${leads.length}`);
    
    let fixedCount = 0;
    const errors = [];
    
    for (const lead of leads) {
      try {
        if (!lead.SOURCE_ID && lead.SOURCE_DESCRIPTION) {
          // Пытаемся извлечь ID из описания
          const match = lead.SOURCE_DESCRIPTION.match(/\d+/);
          if (match) {
            const sourceId = match[0];
            
            // Обновляем лид в Bitrix24
            await bitrixService.updateLead(lead.ID, {
              SOURCE_ID: sourceId
            });
            
            fixedCount++;
            console.log(`✅ Исправлен лид ${lead.ID}: SOURCE_ID = ${sourceId}`);
          }
        }
      } catch (itemError) {
        errors.push({
          leadId: lead.ID,
          error: itemError.message
        });
        console.error(`❌ Ошибка исправления лида ${lead.ID}:`, itemError);
      }
    }
    
    console.log(`✅ Исправление завершено: ${fixedCount} лидов`);
    
    res.json({
      success: true,
      message: `Исправлено ${fixedCount} лидов`,
      fixed: fixedCount,
      errors: errors.length,
      errorDetails: errors.slice(0, 10) // Первые 10 ошибок
    });
    
  } catch (error) {
    console.error('❌ Ошибка исправления SOURCE_ID:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка исправления SOURCE_ID в лидах'
    });
  }
}

/**
 * Получение воронок сделок
 */
async function getDealCategories(req, res) {
  try {
    console.log('📊 Запрос воронок сделок');
    
    const categories = await bitrixService.getDealCategories();
    console.log(`✅ Получено воронок: ${categories.length}`);
    
    res.json({
      success: true,
      data: categories,
      total: categories.length
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения воронок сделок:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения воронок сделок'
    });
  }
}

module.exports = {
  getSources,
  syncSources,
  getLeadsAnalytics,
  getLeadStages,
  fixSourceIds,
  getDealCategories
};
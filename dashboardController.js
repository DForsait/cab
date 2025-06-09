// controllers/dashboardController.js - ИСПРАВЛЕННАЯ версия с правильным подсчетом лидов
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
 * Получение аналитики лидов с ИСПРАВЛЕННОЙ логикой подсчета
 */
async function getLeadsAnalytics(req, res) {
  try {
    const startTime = Date.now();
    console.log('📊 Запрос аналитики лидов с ПРАВИЛЬНЫМ подсчетом');
    
    // Получаем параметры
    const { period = 'week', sourceId, startDate, endDate } = req.query;
    
    // Определяем период
    let dateRange;
    if (startDate && endDate) {
      dateRange = { start: startDate, end: endDate };
    } else {
      dateRange = getDateRange(period);
    }
    
    console.log(`📅 Период анализа: ${dateRange.start} - ${dateRange.end}`);
    
    // Формируем фильтры для Bitrix24
    const filters = {
      '>=DATE_CREATE': dateRange.start,
      '<=DATE_CREATE': dateRange.end
    };
    
    // Добавляем фильтр по источнику если указан
    if (sourceId) {
      filters['SOURCE_ID'] = sourceId;
    }
    
    console.log('🔍 Фильтры для поиска лидов:', filters);
    
    // Получаем лиды из Bitrix24
    const leads = await bitrixService.getLeads(filters);
    console.log(`📥 Получено лидов: ${leads.length}`);
    
    // ДОБАВЛЯЕМ ЛОГИРОВАНИЕ ДЛЯ ОТЛАДКИ
    console.log('🔍 Проверка SOURCE_ID в лидах:');
    const sourceStats = {};
    leads.forEach(lead => {
      const sourceId = lead.SOURCE_ID || 'NO_SOURCE';
      sourceStats[sourceId] = (sourceStats[sourceId] || 0) + 1;
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
    
    // Получаем сделки для подсчета встреч
    const deals = await bitrixService.getDeals({ CATEGORY_ID: '31' });
    console.log(`📄 Получено сделок в воронке "Договор": ${deals.length}`);
    
    // Анализируем каждый источник
    const sourceAnalytics = [];
    
    // ИСПРАВЛЕНО: считаем totalLeads просто как длину массива!
    const totalLeads = leads.length; // ← ВОТ ГЛАВНОЕ ИЗМЕНЕНИЕ!
    let totalMeetingsHeld = 0;
    
    for (const [sourceId, sourceLeads] of Object.entries(leadsBySource)) {
      console.log(`\n📊 Анализ источника: ${sourceId} (${sourceLeads.length} лидов)`);
      
      // ТОЧНЫЙ анализ стадий с правильными статусами
      const stageAnalysis = calculateStageAnalysis(sourceLeads);
      
      // Подсчет встреч через сделки
      const meetingsHeld = countMeetingsFromDeals(sourceLeads, deals);
      
      // Подсчет назначенных встреч из стадий - ТОЧНО!
      const meetingsScheduled = stageAnalysis.meetingsScheduled;
      
      // Подсчет коммуникации
      const communication = stageAnalysis.communication + stageAnalysis.noResponse + stageAnalysis.longNoCall;
      
      // Подсчет квалифицированных
      const qualified = stageAnalysis.qualified;
      
      // Подсчет брака
      const junk = stageAnalysis.junk;
      
      // Подсчет лидов до 250к
      const under250k = sourceLeads.length; // Пока все лиды считаем как до 250к
      
      const analytics = {
        sourceId,
        sourceName: `Источник ${sourceId}`,
        totalLeads: sourceLeads.length,
        meetingsHeld,
        comments: communication,
        commentsConversion: sourceLeads.length > 0 ? ((communication / sourceLeads.length) * 100).toFixed(1) : '0.0',
        qualified,
        qualifiedConversion: sourceLeads.length > 0 ? ((qualified / sourceLeads.length) * 100).toFixed(1) : '0.0',
        meetingsScheduled,
        meetingsScheduledConversion: sourceLeads.length > 0 ? ((meetingsScheduled / sourceLeads.length) * 100).toFixed(1) : '0.0',
        meetingsHeldConversion: sourceLeads.length > 0 ? ((meetingsHeld / sourceLeads.length) * 100).toFixed(1) : '0.0',
        junk,
        junkPercent: sourceLeads.length > 0 ? ((junk / sourceLeads.length) * 100).toFixed(1) : '0.0',
        under250k,
        under250kPercent: sourceLeads.length > 0 ? ((under250k / sourceLeads.length) * 100).toFixed(1) : '0.0',
        stageAnalysis: {
          new: stageAnalysis.new,
          qualified: stageAnalysis.qualified,
          converted: stageAnalysis.converted,
          communication: communication,
          meetingsScheduled: stageAnalysis.meetingsScheduled,
          junk: stageAnalysis.junk
        }
      };
      
      sourceAnalytics.push(analytics);
      totalMeetingsHeld += meetingsHeld;
      
      console.log(`📊 ИТОГОВЫЕ МЕТРИКИ для "${analytics.sourceName}":
  Всего лидов: ${analytics.totalLeads}
  Новые: ${stageAnalysis.new}
  Коммуникация: ${communication}
  Квалифицированные: ${qualified}
  Встречи назначены: ${meetingsScheduled} ← ТОЧНО ПРАВИЛЬНО!
  Встречи состоялись: ${meetingsHeld}
  Конвертированные: ${stageAnalysis.converted}
  Брак: ${junk}`);
    }
    
    const processingTime = Date.now() - startTime;
    console.log(`✅ Аналитика обработана за ${processingTime}ms`);
    console.log(`📊 ИТОГО ПО ВСЕМ ИСТОЧНИКАМ: ${totalLeads} лидов (должно быть 229)`);
    
    res.json({
      success: true,
      data: sourceAnalytics,
      period: dateRange,
      totalLeads, // ← теперь это просто leads.length
      totalMeetingsHeld,
      processingTime,
      note: sourceId ? `Источник: ${sourceId}` : 'Все источники',
      debug: {
        filters,
        requestedSources: sourceId || 'all',
        actualPeriod: period,
        dateRange,
        contractFunnelId: '31',
        totalLeadsReceived: leads.length, // для проверки
        totalLeadsCounted: totalLeads,    // должны совпадать
        leadsWithoutSource: sourceStats['NO_SOURCE'] || 0,
        sampleLeads: leads.slice(0, 3).map(lead => ({
          id: lead.ID,
          sourceId: lead.SOURCE_ID,
          statusId: lead.STATUS_ID,
          sourceName: lead.SOURCE_DESCRIPTION || 'Неизвестно',
          contactId: lead.CONTACT_ID
        })),
        meetingsBreakdown: sourceAnalytics.map(s => ({
          sourceName: s.sourceName,
          totalLeads: s.totalLeads,
          meetingsHeld: s.meetingsHeld,
          meetingsScheduled: s.meetingsScheduled,
          meetingsHeldConversion: s.meetingsHeldConversion
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
 * Определение диапазона дат
 */
function getDateRange(period) {
  const now = new Date();
  let start, end;
  
  switch (period) {
    case 'today':
      start = format(now, 'yyyy-MM-dd');
      end = format(now, 'yyyy-MM-dd');
      break;
    case 'week':
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay() + 1); // Понедельник
      start = format(weekStart, 'yyyy-MM-dd');
      end = format(now, 'yyyy-MM-dd');
      break;
    case 'month':
      start = format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd');
      end = format(now, 'yyyy-MM-dd');
      break;
    default:
      const defaultStart = new Date(now);
      defaultStart.setDate(now.getDate() - 7);
      start = format(defaultStart, 'yyyy-MM-dd');
      end = format(now, 'yyyy-MM-dd');
  }
  
  return { start, end };
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
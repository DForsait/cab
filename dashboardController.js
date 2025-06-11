// controllers/dashboardController.js - ИСПРАВЛЕННАЯ версия со счетом встреч по статусам лидов
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
  
  // ВСЕ виды брака с ТОЧНЫМИ ID из вашего списка + новый статус
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
      'UC_DFO4SC',              // Дубль
      //'UC_IN9DMO'               // Новый неизвестный статус (добавлен)
    ],
    name: 'Брак',
    type: 'junk'
  },
  // НОВАЯ КАТЕГОРИЯ для неизвестных статусов
  unknown: {
    statuses: ['UC_IN9DMO'],
    name: 'Неизвестный статус',
    type: 'unknown'
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
 * ИСПРАВЛЕННАЯ функция получения дат с учетом московского времени
 */
function getPeriodDates(period, startDate, endDate) {
  const now = new Date();
  
  console.log(`🔧 ПОЛУЧЕН ЗАПРОС: period="${period}", startDate="${startDate}", endDate="${endDate}"`);
  
  // Функция для создания даты в московском времени
  function toMoscowDateTime(dateString, isEndOfDay = false) {
    const date = new Date(dateString);
    if (isEndOfDay) {
      date.setHours(23, 59, 59, 999);
    } else {
      date.setHours(0, 0, 0, 0);
    }
    
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
      startOfWeek.setDate(now.getDate() - now.getDay() + 1);
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
 * 📊 ФУНКЦИЯ ПОЛУЧЕНИЯ НАЗВАНИЙ ИСТОЧНИКОВ
 */
async function getSourceNames() {
  try {
    const sources = await LeadSource.find({}).select('bitrixId name');
    const sourceMap = {};
    sources.forEach(source => {
      sourceMap[source.bitrixId] = source.name;
    });
    return sourceMap;
  } catch (error) {
    console.error('❌ Ошибка получения названий источников:', error);
    return {};
  }
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
          existingSource.name = source.NAME || `Источник ${source.ID}`;
          existingSource.lastSync = new Date();
          await existingSource.save();
          updatedCount++;
        } else {
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
    junk: 0,
    unknown: 0
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
 * 🎯 ИСПРАВЛЕННАЯ ФУНКЦИЯ - СЧИТАЕМ ВСТРЕЧИ ПО СТАТУСАМ ЛИДОВ
 */
function countMeetingsFromLeadStatus(sourceLeads) {
  const convertedLeads = sourceLeads.filter(lead => 
    lead.STATUS_ID === 'CONVERTED'
  );
  
  console.log(`📊 ВСТРЕЧИ через статус лидов: ${convertedLeads.length}`);
  convertedLeads.forEach((lead, index) => {
    console.log(`  Лид ${index + 1}: ID ${lead.ID}, статус ${lead.STATUS_ID}`);
  });
  
  return convertedLeads.length;
}

/**
 * Группировка лидов по источникам
 */
function groupLeadsBySource(leads) {
  const grouped = {};
  
  leads.forEach(lead => {
    const sourceId = lead.SOURCE_ID || 'NO_SOURCE';
    if (!grouped[sourceId]) {
      grouped[sourceId] = [];
    }
    grouped[sourceId].push(lead);
  });
  
  return grouped;
}

/**
 * ИСПРАВЛЕННАЯ функция получения аналитики лидов - СЧИТАЕМ ВСТРЕЧИ ПО СТАТУСАМ
 */
async function getLeadsAnalytics(req, res) {
  try {
    const startTime = Date.now();
    console.log('📊 Запрос аналитики лидов - ВСТРЕЧИ ПО СТАТУСАМ ЛИДОВ');
    
    const { period = 'week', sourceId, startDate, endDate } = req.query;
    
    console.log('🔍 Входящие параметры:', { period, sourceId, startDate, endDate });
    
    const dateRange = getPeriodDates(period, startDate, endDate);
    console.log(`📅 Период анализа: ${dateRange.start} - ${dateRange.end}`);
    
    const filters = {
      '>=DATE_CREATE': dateRange.start,
      '<=DATE_CREATE': dateRange.end
    };
    
    if (sourceId && sourceId !== 'all') {
      filters['SOURCE_ID'] = sourceId;
    }
    
    console.log('🔍 Фильтры для Bitrix24 с московским временем:', filters);
    
    // Получаем лиды из Bitrix24
    const leads = await bitrixService.getLeads(filters);
    console.log(`📥 Получено лидов: ${leads.length}`);
    
    // 🔍 ВРЕМЕННЫЙ DEBUG ДЛЯ ПРОВЕРКИ СТРУКТУРЫ ЛИДОВ
    if (leads.length > 0) {
      console.log('🔍 ПОЛНАЯ СТРУКТУРА ПЕРВОГО ЛИДА:');
      console.log('Все поля лида:', Object.keys(leads[0]));
      console.log('Поля ответственности:', {
        ASSIGNED_BY_ID: leads[0].ASSIGNED_BY_ID,
        RESPONSIBLE_USER_ID: leads[0].RESPONSIBLE_USER_ID,
        CREATED_BY_ID: leads[0].CREATED_BY_ID,
        MODIFY_BY_ID: leads[0].MODIFY_BY_ID
      });
    }
    
    // 📊 ПОЛУЧАЕМ НАЗВАНИЯ ИСТОЧНИКОВ
    const sourceNames = await getSourceNames();
    
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
    
    const leadsBySource = groupLeadsBySource(leads);
    console.log(`📊 Источников с лидами: ${Object.keys(leadsBySource).length}`);
    
    const totalLeadsCheck = Object.values(leadsBySource).reduce((sum, leads) => sum + leads.length, 0);
    console.log(`✅ Проверка: получено ${leads.length} лидов, сгруппировано ${totalLeadsCheck} лидов`);
    if (leads.length !== totalLeadsCheck) {
      console.error(`❌ ПОТЕРЯ ДАННЫХ: ${leads.length - totalLeadsCheck} лидов потеряно при группировке!`);
    }
    
    const sourceAnalytics = [];
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
      
      console.log(`\n📊 Анализ источника: ${currentSourceId} (${sourceLeads.length} лидов)`);
      
      // 📝 ПОЛУЧАЕМ НАЗВАНИЕ ИСТОЧНИКА
      const sourceName = sourceNames[currentSourceId] || `Источник ${currentSourceId}`;
      
      const stageAnalysis = calculateStageAnalysis(sourceLeads);
      
      // 🎯 ГЛАВНОЕ ИЗМЕНЕНИЕ - СЧИТАЕМ ВСТРЕЧИ ПО СТАТУСАМ ЛИДОВ
      const meetingsHeld = countMeetingsFromLeadStatus(sourceLeads);
      
      const meetingsScheduled = stageAnalysis.meetingsScheduled;
      const communication = stageAnalysis.communication + stageAnalysis.noResponse + stageAnalysis.longNoCall;
      const qualified = stageAnalysis.qualified;
      const junk = stageAnalysis.junk;
      const under250k = sourceLeads.length;
      
      // 🎯 ИСПРАВЛЕННАЯ ЛОГИКА НАЗНАЧЕННЫХ ВСТРЕЧ
      // Все назначенные = статус "назначена" + все состоявшиеся (так как состоявшиеся были назначены)
      const meetingsScheduledTotal = meetingsScheduled + meetingsHeld;
      
      // Конверсия из назначенной в состоявшуюся
      const meetingsHeldFromScheduledConversion = meetingsScheduledTotal > 0 
        ? ((meetingsHeld / meetingsScheduledTotal) * 100).toFixed(1)
        : '0.0';
      
      const analytics = {
        sourceId: currentSourceId,
        sourceName,
        totalLeads: sourceLeads.length,
        meetingsHeld, // 🎯 Теперь по статусам лидов!
        comments: communication,
        commentsConversion: sourceLeads.length > 0 ? ((communication / sourceLeads.length) * 100).toFixed(1) : '0.0',
        qualified,
        qualifiedConversion: sourceLeads.length > 0 ? ((qualified / sourceLeads.length) * 100).toFixed(1) : '0.0',
        meetingsScheduled: meetingsScheduledTotal, // ИСПРАВЛЕНО!
        meetingsScheduledConversion: sourceLeads.length > 0 ? ((meetingsScheduledTotal / sourceLeads.length) * 100).toFixed(1) : '0.0',
        meetingsHeldConversion: sourceLeads.length > 0 ? ((meetingsHeld / sourceLeads.length) * 100).toFixed(1) : '0.0',
        meetingsHeldFromScheduledConversion, // НОВАЯ метрика
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
          junk: stageAnalysis.junk,
          unknown: stageAnalysis.unknown
        }
      };
      
      sourceAnalytics.push(analytics);
      totalMeetingsHeld += meetingsHeld;
      
      console.log(`📊 ИТОГОВЫЕ МЕТРИКИ для "${analytics.sourceName}":
  Всего лидов: ${analytics.totalLeads}
  Встречи состоялись: ${meetingsHeld} ← ПО СТАТУСАМ ЛИДОВ!
  Встречи назначены: ${meetingsScheduledTotal}
  CR из назначенной в состоявшуюся: ${meetingsHeldFromScheduledConversion}%
  Конвертированные: ${stageAnalysis.converted}
  Брак: ${junk}`);
    }
    
    const processingTime = Date.now() - startTime;
    console.log(`✅ Аналитика обработана за ${processingTime}ms`);
    console.log(`📊 ИТОГО ПО ВСЕМ ИСТОЧНИКАМ: ${totalLeads} лидов, ${totalMeetingsHeld} встреч`);
    
    res.json({
      success: true,
      data: sourceAnalytics,
      period: dateRange,
      totalLeads,
      totalMeetingsHeld, // 🎯 Теперь должно быть 36!
      processingTime,
      note: `Анализ ${totalLeads} лидов из ${sourceAnalytics.length} источников (встречи по статусам лидов)`,
      debug: {
        filters,
        requestedSources: sourceId || 'all',
        actualPeriod: period,
        dateRange,
        contractFunnelId: '31',
        totalLeadsReceived: leads.length,
        totalLeadsCounted: totalLeads,
        leadsWithoutSource: sourceStats['NO_SOURCE'] || 0,
        
        // 🔍 РАСШИРЕННЫЙ DEBUG ДЛЯ АНАЛИЗА СТРУКТУРЫ ЛИДОВ
        fullLeadStructure: leads.length > 0 ? Object.keys(leads[0]) : [],
        
        sampleLeads: leads.slice(0, 3).map(lead => ({
          id: lead.ID,
          sourceId: lead.SOURCE_ID,
          statusId: lead.STATUS_ID,
          sourceName: lead.SOURCE_DESCRIPTION || 'Неизвестно',
          contactId: lead.CONTACT_ID,
          // 🎯 ПОЛЯ ДЛЯ АНАЛИТИКИ СОТРУДНИКОВ
          assignedById: lead.ASSIGNED_BY_ID,
          responsibleUserId: lead.RESPONSIBLE_USER_ID,
          createdById: lead.CREATED_BY_ID,
          modifiedById: lead.MODIFY_BY_ID,
          dateCreate: lead.DATE_CREATE,
          dateModify: lead.DATE_MODIFY
        })),
        
        meetingsBreakdown: sourceAnalytics.slice(0, 5).map(item => ({
          sourceName: item.sourceName,
          totalLeads: item.totalLeads,
          meetingsHeld: item.meetingsHeld,
          meetingsScheduled: item.meetingsScheduled,
          meetingsHeldConversion: item.meetingsHeldConversion,
          meetingsHeldFromScheduledConversion: item.meetingsHeldFromScheduledConversion
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
 * Получение стадий лидов с ТОЧНЫМИ статусами из API
 */
async function getLeadStages(req, res) {
  try {
    console.log('📊 Запрос стадий лидов');
    
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
    
    const leads = await bitrixService.getLeads({});
    console.log(`📥 Получено лидов для проверки: ${leads.length}`);
    
    let fixedCount = 0;
    const errors = [];
    
    for (const lead of leads) {
      try {
        if (!lead.SOURCE_ID && lead.SOURCE_DESCRIPTION) {
          const match = lead.SOURCE_DESCRIPTION.match(/\d+/);
          if (match) {
            const sourceId = match[0];
            
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
      errorDetails: errors.slice(0, 10)
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

/**
 * 👥 ФУНКЦИИ ДЛЯ АНАЛИТИКИ СОТРУДНИКОВ
 * Добавить в конец dashboardController.js (перед module.exports)
 */

/**
 * Получение имен сотрудников из Bitrix24 с кэшированием
 */
async function getEmployeeNames() {
  try {
    console.log('👥 Получение имен сотрудников из Bitrix24');
    const users = await bitrixService.getUsers();
    const employeeMap = {};
    
    users.forEach(user => {
      employeeMap[user.ID] = {
        id: user.ID,
        name: `${user.NAME || ''} ${user.LAST_NAME || ''}`.trim() || `Пользователь ${user.ID}`,
        email: user.EMAIL || '',
        position: user.WORK_POSITION || '',
        active: user.ACTIVE === 'Y'
      };
    });
    
    console.log(`✅ Обработано сотрудников: ${Object.keys(employeeMap).length}`);
    return employeeMap;
  } catch (error) {
    console.error('❌ Ошибка получения имен сотрудников:', error);
    return {};
  }
}

/**
 * Группировка лидов по сотрудникам
 */
function groupLeadsByEmployee(leads) {
  const grouped = {};
  
  leads.forEach(lead => {
    const employeeId = lead.ASSIGNED_BY_ID || 'NO_EMPLOYEE';
    if (!grouped[employeeId]) {
      grouped[employeeId] = [];
    }
    grouped[employeeId].push(lead);
  });
  
  return grouped;
}

/**
 * Анализ источников для конкретного сотрудника
 */
function analyzeEmployeeSources(employeeLeads, sourceNames) {
  const sourceStats = {};
  
  // Группируем лиды сотрудника по источникам
  employeeLeads.forEach(lead => {
    const sourceId = lead.SOURCE_ID || 'NO_SOURCE';
    if (!sourceStats[sourceId]) {
      sourceStats[sourceId] = [];
    }
    sourceStats[sourceId].push(lead);
  });
  
  const sourceAnalytics = [];
  
  // Анализируем каждый источник для сотрудника
  Object.entries(sourceStats).forEach(([sourceId, sourceLeads]) => {
    const sourceName = sourceNames[sourceId] || `Источник ${sourceId}`;
    const stageAnalysis = calculateStageAnalysis(sourceLeads);
    
    // Используем ту же логику что и в основной аналитике
    const meetingsHeld = countMeetingsFromLeadStatus(sourceLeads);
    const meetingsScheduled = stageAnalysis.meetingsScheduled;
    const communication = stageAnalysis.communication + stageAnalysis.noResponse + stageAnalysis.longNoCall;
    const qualified = stageAnalysis.qualified;
    const junk = stageAnalysis.junk;
    
    // Общее количество назначенных встреч
    const meetingsScheduledTotal = meetingsScheduled + meetingsHeld;
    
    // Конверсии
    const meetingsHeldFromScheduledConversion = meetingsScheduledTotal > 0 
      ? ((meetingsHeld / meetingsScheduledTotal) * 100).toFixed(1)
      : '0.0';
    
    sourceAnalytics.push({
      sourceId,
      sourceName,
      totalLeads: sourceLeads.length,
      comments: communication,
      commentsConversion: sourceLeads.length > 0 ? ((communication / sourceLeads.length) * 100).toFixed(1) : '0.0',
      qualified,
      qualifiedConversion: sourceLeads.length > 0 ? ((qualified / sourceLeads.length) * 100).toFixed(1) : '0.0',
      meetingsScheduled: meetingsScheduledTotal,
      meetingsScheduledConversion: sourceLeads.length > 0 ? ((meetingsScheduledTotal / sourceLeads.length) * 100).toFixed(1) : '0.0',
      meetingsHeld,
      meetingsHeldConversion: sourceLeads.length > 0 ? ((meetingsHeld / sourceLeads.length) * 100).toFixed(1) : '0.0',
      meetingsHeldFromScheduledConversion,
      junk,
      junkPercent: sourceLeads.length > 0 ? ((junk / sourceLeads.length) * 100).toFixed(1) : '0.0'
    });
  });
  
  // Сортируем по количеству лидов (убывание)
  return sourceAnalytics.sort((a, b) => b.totalLeads - a.totalLeads);
}

/**
 * 🎯 ОСНОВНАЯ ФУНКЦИЯ - АНАЛИТИКА ПО СОТРУДНИКАМ
 * Использует ТЕ ЖЕ фильтры что и основная аналитика источников
 */
async function getEmployeesAnalytics(req, res) {
  try {
    const startTime = Date.now();
    console.log('👥 Запрос аналитики по сотрудникам');
    
    // 🎯 ИСПОЛЬЗУЕМ ТЕ ЖЕ ПАРАМЕТРЫ что и в основной аналитике
    const { period = 'week', sourceId, startDate, endDate, employeeId } = req.query;
    
    console.log('🔍 Входящие параметры аналитики сотрудников:', { 
      period, sourceId, startDate, endDate, employeeId 
    });
    
    const dateRange = getPeriodDates(period, startDate, endDate);
    console.log(`📅 Период анализа сотрудников: ${dateRange.start} - ${dateRange.end}`);
    
    // 🎯 ТЕ ЖЕ ФИЛЬТРЫ что и для источников
    const filters = {
      '>=DATE_CREATE': dateRange.start,
      '<=DATE_CREATE': dateRange.end
    };
    
    // Фильтр по источнику (как в основной аналитике)
    if (sourceId && sourceId !== 'all') {
      if (sourceId.includes(',')) {
        // Если выбрано несколько источников
        const sourceIds = sourceId.split(',');
        console.log(`🔍 Фильтр по источникам: ${sourceIds.join(', ')}`);
        // Bitrix24 может не поддерживать массивы в фильтрах, поэтому получаем все и фильтруем после
      } else {
        filters['SOURCE_ID'] = sourceId;
      }
    }
    
    // Фильтр по конкретному сотруднику
    if (employeeId && employeeId !== 'all') {
      filters['ASSIGNED_BY_ID'] = employeeId;
    }
    
    console.log('🔍 Фильтры для получения лидов сотрудников:', filters);
    
    // Получаем данные параллельно для производительности
    const [leads, employeeNames, sourceNames] = await Promise.all([
      bitrixService.getLeads(filters),
      getEmployeeNames(),
      getSourceNames()
    ]);
    
    console.log(`📥 Получено лидов для анализа сотрудников: ${leads.length}`);
    console.log(`👥 Получено сотрудников из системы: ${Object.keys(employeeNames).length}`);
    
    // 🎯 ДОПОЛНИТЕЛЬНАЯ ФИЛЬТРАЦИЯ ПО ИСТОЧНИКАМ (если выбрано несколько)
    let filteredLeads = leads;
    if (sourceId && sourceId !== 'all' && sourceId.includes(',')) {
      const sourceIds = sourceId.split(',');
      filteredLeads = leads.filter(lead => sourceIds.includes(lead.SOURCE_ID));
      console.log(`🔍 После фильтрации по источникам осталось лидов: ${filteredLeads.length}`);
    }
    
    if (filteredLeads.length === 0) {
      return res.json({
        success: true,
        data: [],
        period: dateRange,
        totalLeads: 0,
        totalEmployees: 0,
        totalMeetingsHeld: 0,
        note: 'Лиды не найдены за указанный период для выбранных фильтров'
      });
    }
    
    // Группируем лиды по сотрудникам
    const leadsByEmployee = groupLeadsByEmployee(filteredLeads);
    console.log(`👥 Сотрудников с лидами: ${Object.keys(leadsByEmployee).length}`);
    
    const employeeAnalytics = [];
    let totalMeetingsHeld = 0;
    let totalLeadsCount = 0;
    
    // Анализируем каждого сотрудника
    for (const [currentEmployeeId, employeeLeads] of Object.entries(leadsByEmployee)) {
      if (currentEmployeeId === 'NO_EMPLOYEE') continue; // Пропускаем лиды без ответственного
      
      console.log(`\n👤 Анализ сотрудника: ${currentEmployeeId} (${employeeLeads.length} лидов)`);
      
      const employee = employeeNames[currentEmployeeId] || {
        id: currentEmployeeId,
        name: `Сотрудник ${currentEmployeeId}`,
        email: '',
        position: '',
        active: true
      };
      
      // Общая статистика сотрудника
      const stageAnalysis = calculateStageAnalysis(employeeLeads);
      const employeeMeetingsHeld = countMeetingsFromLeadStatus(employeeLeads);
      const employeeMeetingsScheduled = stageAnalysis.meetingsScheduled + employeeMeetingsHeld;
      const employeeCommunication = stageAnalysis.communication + stageAnalysis.noResponse + stageAnalysis.longNoCall;
      const employeeJunk = stageAnalysis.junk;
      
      // Анализ источников для сотрудника
      const sourceAnalytics = analyzeEmployeeSources(employeeLeads, sourceNames);
      
      const employeeData = {
        employee: {
          id: currentEmployeeId,
          name: employee.name,
          email: employee.email,
          position: employee.position,
          active: employee.active,
          totalLeads: employeeLeads.length,
          totalMeetingsHeld: employeeMeetingsHeld,
          totalMeetingsScheduled: employeeMeetingsScheduled,
          totalCommunication: employeeCommunication,
          totalJunk: employeeJunk,
          overallConversion: employeeLeads.length > 0 ? ((employeeMeetingsHeld / employeeLeads.length) * 100).toFixed(1) : '0.0',
          meetingsFromScheduledConversion: employeeMeetingsScheduled > 0 ? ((employeeMeetingsHeld / employeeMeetingsScheduled) * 100).toFixed(1) : '0.0'
        },
        sources: sourceAnalytics
      };
      
      employeeAnalytics.push(employeeData);
      totalMeetingsHeld += employeeMeetingsHeld;
      totalLeadsCount += employeeLeads.length;
      
      console.log(`👤 ИТОГИ для "${employee.name}":
  Лидов: ${employeeLeads.length}
  Встреч: ${employeeMeetingsHeld}
  Источников: ${sourceAnalytics.length}
  Конверсия: ${employeeData.employee.overallConversion}%`);
    }
    
    // Сортируем сотрудников по количеству встреч (по убыванию)
    employeeAnalytics.sort((a, b) => b.employee.totalMeetingsHeld - a.employee.totalMeetingsHeld);
    
    const processingTime = Date.now() - startTime;
    console.log(`✅ Аналитика по сотрудникам обработана за ${processingTime}ms`);
    console.log(`👥 ИТОГО: ${employeeAnalytics.length} сотрудников, ${totalLeadsCount} лидов, ${totalMeetingsHeld} встреч`);
    
    res.json({
      success: true,
      data: employeeAnalytics,
      period: dateRange,
      totalLeads: totalLeadsCount,
      totalEmployees: employeeAnalytics.length,
      totalMeetingsHeld,
      averageConversion: totalLeadsCount > 0 ? ((totalMeetingsHeld / totalLeadsCount) * 100).toFixed(1) : '0.0',
      processingTime,
      note: `Анализ ${employeeAnalytics.length} сотрудников с ${totalLeadsCount} лидами`,
      debug: {
        filters,
        dateRange,
        // 🎯 ДОБАВЛЕНО: actualPeriod для совместимости с frontend
        actualPeriod: period === 'custom' ? `${startDate} — ${endDate}` : period,
        originalLeadsCount: leads.length,
        filteredLeadsCount: filteredLeads.length,
        totalEmployeesInSystem: Object.keys(employeeNames).length,
        employeesWithLeads: employeeAnalytics.length,
        leadsWithoutEmployee: leadsByEmployee['NO_EMPLOYEE']?.length || 0,
        appliedFilters: {
          period,
          sourceId: sourceId || 'all',
          employeeId: employeeId || 'all'
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения аналитики по сотрудникам:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения аналитики по сотрудникам'
    });
  }
}


module.exports = {
  getSources,
  syncSources,
  getLeadsAnalytics,
  getEmployeesAnalytics,
  getLeadStages,
  fixSourceIds,
  getDealCategories
};
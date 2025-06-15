const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const bitrixService = require('../bitrix/bitrixService');

// Роуты дашборда
router.get('/sources', dashboardController.getSources);
router.post('/sync-sources', dashboardController.syncSources);
router.get('/leads-analytics', dashboardController.getLeadsAnalytics);
router.get('/lead-stages', dashboardController.getLeadStages);
router.post('/fix-source-ids', dashboardController.fixSourceIds);

// НОВЫЙ роут: Получение воронок сделок
//router.get('/deal-categories', dashboardController.getDealCategories);

// НОВЫЙ РОУТ для аналитики по сотрудникам
router.get('/employees-analytics', dashboardController.getEmployeesAnalytics);

// API роут для аналитики продаж
router.get('/sales', dashboardController.getSalesAnalytics);

// 🧪 ТЕСТОВЫЙ РОУТ ДЛЯ СЫРЫХ ДАННЫХ ПРОДАЖ
// Добавить в /home/cab/routes/dashboardRoutes.js

// Тестовый роут для получения сырых данных сделок
router.get('/test-raw-sales', async (req, res) => {
  try {
    console.log('🧪 ТЕСТ: Получение сырых данных продаж');
    
    // Получаем сырые сделки без обработки
    const rawSales = await bitrixService.getDeals({
      'CATEGORY_ID': '31',     // Воронка "Договор"
      'STAGE_ID': 'C31:WON',  // Стадия "Внесена предоплата"
      '>=DATE_CREATE': '2025-06-01T00:00:00',
      '<=DATE_CREATE': '2025-06-07T23:59:59'
    });
    
    console.log(`🧪 Найдено сырых продаж: ${rawSales?.length || 0}`);
    
    if (!rawSales || rawSales.length === 0) {
      return res.json({
        success: true,
        message: 'Нет продаж за период',
        count: 0,
        data: []
      });
    }
    
    // Анализируем структуру данных
    const fieldAnalysis = {};
    const sampleSales = rawSales.slice(0, 5); // Берем первые 5 для анализа
    
    rawSales.forEach(sale => {
      Object.keys(sale).forEach(field => {
        if (!fieldAnalysis[field]) {
          fieldAnalysis[field] = {
            count: 0,
            hasValue: 0,
            sampleValues: []
          };
        }
        fieldAnalysis[field].count++;
        if (sale[field] && sale[field] !== '' && sale[field] !== null) {
          fieldAnalysis[field].hasValue++;
          if (fieldAnalysis[field].sampleValues.length < 3) {
            fieldAnalysis[field].sampleValues.push(sale[field]);
          }
        }
      });
    });
    
    // Статистика по ключевым полям
    const keyFields = ['LEAD_ID', 'CONTACT_ID', 'UF_CRM_LEAD_ID', 'ORIGINATOR_ID'];
    const keyFieldsStats = {};
    
    keyFields.forEach(field => {
      const withValue = rawSales.filter(sale => sale[field] && sale[field] !== '' && sale[field] !== null);
      keyFieldsStats[field] = {
        total: rawSales.length,
        withValue: withValue.length,
        percentage: rawSales.length > 0 ? Math.round((withValue.length / rawSales.length) * 100) : 0,
        sampleValues: withValue.slice(0, 3).map(sale => sale[field])
      };
    });
    
    console.log('🧪 Анализ ключевых полей:');
    Object.entries(keyFieldsStats).forEach(([field, stats]) => {
      console.log(`  ${field}: ${stats.withValue}/${stats.total} (${stats.percentage}%)`);
    });
    
    res.json({
      success: true,
      totalSales: rawSales.length,
      period: '2025-06-01 — 2025-06-07',
      
      // Статистика по ключевым полям связывания
      linkingFieldsAnalysis: keyFieldsStats,
      
      // Все поля и их заполненность
      allFieldsAnalysis: Object.fromEntries(
        Object.entries(fieldAnalysis)
          .sort(([,a], [,b]) => b.hasValue - a.hasValue)
          .slice(0, 20) // Топ-20 наиболее заполненных полей
      ),
      
      // Примеры сделок для анализа структуры
      sampleSales: sampleSales.map(sale => ({
        ID: sale.ID,
        TITLE: sale.TITLE,
        LEAD_ID: sale.LEAD_ID,
        CONTACT_ID: sale.CONTACT_ID,
        UF_CRM_LEAD_ID: sale.UF_CRM_LEAD_ID,
        ORIGINATOR_ID: sale.ORIGINATOR_ID,
        OPPORTUNITY: sale.OPPORTUNITY,
        DATE_CREATE: sale.DATE_CREATE,
        ASSIGNED_BY_ID: sale.ASSIGNED_BY_ID
      })),
      
      // Полная структура первой сделки
      firstSaleFullStructure: rawSales[0]
    });
    
  } catch (error) {
    console.error('❌ Ошибка тестового роута сырых продаж:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 🧪 ТАКЖЕ ДОБАВИТЬ В module.exports В КОНЦЕ ФАЙЛА:
// Ничего не нужно добавлять в exports - это просто роут

module.exports = router;
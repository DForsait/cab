const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

// Роуты дашборда
router.get('/sources', dashboardController.getSources);
router.post('/sync-sources', dashboardController.syncSources);
router.get('/leads-analytics', dashboardController.getLeadsAnalytics);
router.get('/lead-stages', dashboardController.getLeadStages);
router.post('/fix-source-ids', dashboardController.fixSourceIds);

// НОВЫЙ роут: Получение воронок сделок
router.get('/deal-categories', dashboardController.getDealCategories);

// НОВЫЙ РОУТ для аналитики по сотрудникам
router.get('/employees-analytics', dashboardController.getEmployeesAnalytics);

module.exports = router;
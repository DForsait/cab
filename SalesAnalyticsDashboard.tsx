import React, { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, Calendar, Clock, RefreshCw } from 'lucide-react';

interface SalesData {
  sourceId: string;
  sourceName: string;
  totalSales: number;
  totalAmount: number;
  averageAmount: number;
  sales: Array<{
    ID: string;
    TITLE: string;
    OPPORTUNITY: string;
    amount: number;
    leadDate: string;
    leadDateFormatted: string;
    saleDate: string;
    saleDateFormatted: string;
    dealCycle: string;
    dealCycleDays: number;
    sourceName: string;
  }>;
}

interface SalesApiResponse {
  success: boolean;
  data: SalesData[];
  totals: {
    totalSales: number;
    totalAmount: number;
    averageAmount: number;
    linkingSuccessRate: number;
  };
  debug: {
    salesFound: number;
    uniqueContacts: number;
    leadsFound: number;
    linkedSales: number;
    unknownSales: number;
    linkingStats: {
      dealCycleStats: {
        avgDays: number;
        minDays: number;
        maxDays: number;
        salesWithCycleData: number;
      };
    };
  };
  processingTime: string;
}

interface SalesAnalyticsDashboardProps {
  startDate: string;
  endDate: string;
}

const SalesAnalyticsDashboard: React.FC<SalesAnalyticsDashboardProps> = ({ startDate, endDate }) => {
  const [salesData, setSalesData] = useState<SalesData[]>([]);
  const [salesAnalytics, setSalesAnalytics] = useState<SalesApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchSalesData();
  }, [startDate, endDate]);

  const fetchSalesData = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      params.append('period', 'custom');
      params.append('startDate', startDate);
      params.append('endDate', endDate);

      const response = await fetch(`/api/dashboard/sales?${params}`);
      const data: SalesApiResponse = await response.json();

      if (data.success) {
        setSalesData(data.data);
        setSalesAnalytics(data);
      } else {
        setError('Ошибка загрузки данных продаж');
      }
    } catch (error) {
      setError('Ошибка сети при загрузке данных продаж');
    } finally {
      setLoading(false);
    }
  };

  const toggleSourceExpansion = (sourceId: string) => {
    const newExpanded = new Set(expandedSources);
    if (newExpanded.has(sourceId)) {
      newExpanded.delete(sourceId);
    } else {
      newExpanded.add(sourceId);
    }
    setExpandedSources(newExpanded);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getCycleColor = (days: number | null) => {
    if (days === null) return 'text-gray-500';
    if (days <= 7) return 'text-green-600 font-semibold';
    if (days <= 30) return 'text-orange-600 font-semibold';
    return 'text-red-600 font-semibold';
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mr-3" />
          <span className="text-lg text-gray-600">Загрузка данных продаж...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="text-center py-12">
          <p className="text-red-600 mb-2">{error}</p>
          <button
            onClick={fetchSalesData}
            className="text-blue-600 hover:text-blue-800 underline"
          >
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }

  const totals = salesAnalytics?.totals;
  const cycleStats = salesAnalytics?.debug?.linkingStats?.dealCycleStats;

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      {/* Заголовок блока продаж */}
      <div className="border-l-4 border-green-500 bg-gray-50 px-6 py-4">
        <h2 className="text-xl font-bold text-gray-900 mb-2">
          💰 Аналитика продаж за период
        </h2>
        <p className="text-gray-600">
          Детализация закрытых сделок с источниками, датами и циклами
          <span className="ml-2 text-sm bg-green-100 text-green-800 px-2 py-1 rounded">
            {startDate} — {endDate}
          </span>
          {salesAnalytics?.processingTime && (
            <span className="ml-2 text-xs text-gray-500">
              Обработано за {salesAnalytics.processingTime}
            </span>
          )}
        </p>
      </div>

      {/* Метрики продаж */}
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <div className="bg-green-50 rounded-lg p-4 border border-green-200">
            <div className="flex items-center">
              <div className="p-2 bg-green-100 rounded-lg mr-3">
                <DollarSign className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Всего продаж</p>
                <p className="text-xl font-bold text-gray-900">{totals?.totalSales || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
            <div className="flex items-center">
              <div className="p-2 bg-blue-100 rounded-lg mr-3">
                <TrendingUp className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Общая сумма</p>
                <p className="text-xl font-bold text-gray-900">
                  {totals ? formatCurrency(totals.totalAmount) : '0 ₽'}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
            <div className="flex items-center">
              <div className="p-2 bg-purple-100 rounded-lg mr-3">
                <Calendar className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Средний чек</p>
                <p className="text-xl font-bold text-gray-900">
                  {totals ? formatCurrency(totals.averageAmount) : '0 ₽'}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
            <div className="flex items-center">
              <div className="p-2 bg-orange-100 rounded-lg mr-3">
                <Clock className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Средний цикл</p>
                <p className="text-xl font-bold text-gray-900">
                  {cycleStats?.avgDays ? `${cycleStats.avgDays} дн` : 'Нет данных'}
                </p>
                {cycleStats && (
                  <p className="text-xs text-gray-500">
                    от {cycleStats.minDays} до {cycleStats.maxDays} дн
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Статистика связывания */}
        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Связывание с источниками: <span className="font-semibold text-green-600">{totals?.linkingSuccessRate || 0}%</span>
              {salesAnalytics?.debug && (
                <span className="ml-4">
                  Связано: {salesAnalytics.debug.linkedSales}/{salesAnalytics.debug.salesFound}
                </span>
              )}
            </div>
            <button
              onClick={fetchSalesData}
              className="text-blue-600 hover:text-blue-800 text-sm underline"
            >
              Обновить
            </button>
          </div>
        </div>

        {/* Таблица продаж по источникам */}
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full border-collapse">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Источник
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Продаж
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Сумма
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Средний чек
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Действия
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {salesData.map((source, index) => (
                <React.Fragment key={source.sourceId}>
                  <tr className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">{source.sourceName}</div>
                      <div className="text-sm text-gray-500">{source.sourceId}</div>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {source.totalSales}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {formatCurrency(source.totalAmount)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {formatCurrency(source.averageAmount)}
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => toggleSourceExpansion(source.sourceId)}
                        className="text-blue-600 hover:text-blue-800 text-sm underline"
                      >
                        {expandedSources.has(source.sourceId) ? 'Свернуть' : 'Детали'}
                      </button>
                    </td>
                  </tr>
                  
                  {/* Детальная таблица сделок */}
                  {expandedSources.has(source.sourceId) && (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 bg-gray-50">
                        <div className="overflow-x-auto">
                          <table className="w-full border border-gray-200 rounded-lg">
                            <thead className="bg-gray-100">
                              <tr>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                  ID сделки
                                </th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                  Название
                                </th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                  Дата лида
                                </th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                  Дата продажи
                                </th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                  Цикл сделки
                                </th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                  Сумма
                                </th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {source.sales.map((sale, saleIndex) => (
                                <tr key={sale.ID} className={saleIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                  <td className="px-4 py-2 text-sm font-medium text-blue-600">
                                    {sale.ID}
                                  </td>
                                  <td className="px-4 py-2 text-sm text-gray-900">
                                    {sale.TITLE || 'Без названия'}
                                  </td>
                                  <td className="px-4 py-2 text-sm text-gray-900">
                                    {sale.leadDateFormatted}
                                  </td>
                                  <td className="px-4 py-2 text-sm text-gray-900">
                                    {sale.saleDateFormatted}
                                  </td>
                                  <td className={`px-4 py-2 text-sm ${getCycleColor(sale.dealCycleDays)}`}>
                                    {sale.dealCycle}
                                  </td>
                                  <td className="px-4 py-2 text-sm font-medium text-gray-900">
                                    {formatCurrency(sale.amount)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {salesData.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">Нет продаж за выбранный период</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SalesAnalyticsDashboard;
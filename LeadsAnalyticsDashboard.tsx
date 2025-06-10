import React, { useState, useEffect } from 'react';
import { Calendar, Filter, RefreshCw, Users, TrendingUp, Calendar as CalendarIcon, BarChart3 } from 'lucide-react';

interface AnalyticsData {
  sourceId: string;
  sourceName: string;
  totalLeads: number;
  comments: number;
  commentsConversion: string;
  qualified: number;
  qualifiedConversion: string;
  meetingsScheduled: number;
  meetingsScheduledConversion: string;
  meetingsHeld: number;
  meetingsHeldConversion: string;
  meetingsHeldFromScheduledConversion: string;
  junk: number;
  junkPercent: string;
  under250k: number;
  under250kPercent: string;
  stageAnalysis?: {
    new: number;
    qualified: number;
    converted: number;
    communication: number;
    meetingsScheduled: number;
    junk: number;
  };
}

interface Source {
  _id: string;
  bitrixId: string;
  name: string;
}

interface ApiResponse {
  success: boolean;
  data: AnalyticsData[];
  period: {
    start: string;
    end: string;
  };
  totalLeads: number;
  totalMeetingsHeld: number;
  processingTime: number;
  note: string;
  error?: string;
  debug?: {
    filters: any;
    requestedSources: string;
    actualPeriod: string;
    dateRange: any;
    sampleLeads: any[];
    meetingsBreakdown: any[];
  };
}

const LeadsAnalyticsDashboard: React.FC = () => {
  const [period, setPeriod] = useState('week');
  const [sourceId, setSourceId] = useState('all');
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData[]>([]);
  const [analytics, setAnalytics] = useState<ApiResponse | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<keyof AnalyticsData>('totalLeads');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Загрузка источников
  useEffect(() => {
    fetchSources();
  }, []);

  // Загрузка аналитики при изменении параметров
  useEffect(() => {
    fetchAnalytics();
  }, [period, sourceId, customStartDate, customEndDate]);

  const fetchSources = async () => {
    try {
      const response = await fetch('/api/dashboard/sources');
      const data = await response.json();
      if (data.success) {
        setSources(data.data);
        console.log('✅ Загружено источников:', data.data.length);
      } else {
        console.error('❌ Ошибка загрузки источников:', data.error);
      }
    } catch (error) {
      console.error('❌ Ошибка сети при загрузке источников:', error);
    }
  };

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      params.append('period', period);
      
      if (period === 'custom') {
        if (customStartDate && customEndDate) {
          params.append('startDate', customStartDate);
          params.append('endDate', customEndDate);
        } else {
          const endDate = new Date();
          const startDate = new Date(endDate);
          startDate.setDate(endDate.getDate() - 7);
          
          const formatDate = (date: Date) => date.toISOString().split('T')[0];
          params.append('startDate', formatDate(startDate));
          params.append('endDate', formatDate(endDate));
          
          setCustomStartDate(formatDate(startDate));
          setCustomEndDate(formatDate(endDate));
        }
      }
      
      if (sourceId !== 'all') {
        params.append('sourceId', sourceId);
      }

      const requestUrl = `/api/dashboard/leads-analytics?${params}`;
      
      const response = await fetch(requestUrl);
      const data: ApiResponse = await response.json();
      
      if (data.success) {
        setAnalyticsData(data.data);
        setAnalytics(data);
      } else {
        setError(data.error || 'Ошибка загрузки данных');
      }
    } catch (error) {
      setError('Ошибка сети при загрузке данных');
    } finally {
      setLoading(false);
    }
  };

  const handlePeriodChange = (newPeriod: string) => {
    setPeriod(newPeriod);
    
    if (newPeriod === 'custom' && (!customStartDate || !customEndDate)) {
      const endDate = new Date();
      const startDate = new Date(endDate);
      startDate.setDate(endDate.getDate() - 7);
      
      const formatDate = (date: Date) => date.toISOString().split('T')[0];
      setCustomStartDate(formatDate(startDate));
      setCustomEndDate(formatDate(endDate));
    }
  };

  const handleSourceChange = (sourceIdToToggle: string) => {
    if (sourceIdToToggle === 'all') {
      setSelectedSources([]);
      setSourceId('all');
    } else {
      const newSelectedSources = selectedSources.includes(sourceIdToToggle)
        ? selectedSources.filter(id => id !== sourceIdToToggle)
        : [...selectedSources, sourceIdToToggle];
      
      setSelectedSources(newSelectedSources);
      const newSourceId = newSelectedSources.length > 0 ? newSelectedSources.join(',') : 'all';
      setSourceId(newSourceId);
    }
  };

  const handleRefresh = () => {
    fetchAnalytics();
  };

  const handleSort = (field: keyof AnalyticsData) => {
    if (field === sortField) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedData = [...analyticsData].sort((a, b) => {
    const aVal = typeof a[sortField] === 'string' ? parseFloat(a[sortField] as string) || 0 : a[sortField] as number;
    const bVal = typeof b[sortField] === 'string' ? parseFloat(b[sortField] as string) || 0 : b[sortField] as number;
    
    if (sortDirection === 'asc') {
      return aVal - bVal;
    } else {
      return bVal - aVal;
    }
  });

  const totalLeads = analytics?.totalLeads || 0;
  const totalMeetingsHeld = analytics?.totalMeetingsHeld || 0;
  const totalMeetingsScheduled = analyticsData.reduce((sum, item) => sum + (item.meetingsScheduled || 0), 0);
  const totalSources = analyticsData.length;

  const getConversionColor = (value: string) => {
    const numValue = parseFloat(value);
    if (numValue >= 50) return 'text-green-600 font-semibold';
    if (numValue >= 20) return 'text-orange-600 font-semibold';
    return 'text-red-600 font-semibold';
  };

  const isSourceSelected = (sourceIdToCheck: string) => {
    return selectedSources.includes(sourceIdToCheck);
  };

  const isAllSourcesSelected = () => {
    return selectedSources.length === 0;
  };

  const getLoadingStatus = () => {
    if (loading) return 'Загрузка данных...';
    if (error) return `Ошибка: ${error}`;
    if (sortedData.length === 0) return 'Нет данных для отображения';
    return `Показано ${sortedData.length} источников`;
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Заголовок */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Аналитика лидов по источникам
          </h1>
          <p className="text-gray-600">
            Конверсия в назначение и состояние встреч
            {analytics?.period && (
              <span className="ml-2 text-sm bg-blue-100 text-blue-800 px-2 py-1 rounded">
                {analytics.period.start} — {analytics.period.end}
              </span>
            )}
            {analytics?.processingTime && (
              <span className="ml-2 text-xs text-gray-500">
                Обработано за {analytics.processingTime}ms
              </span>
            )}
          </p>
        </div>

        {/* Фильтры */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-48">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Calendar className="inline w-4 h-4 mr-1" />
                Период:
              </label>
              <select
                value={period}
                onChange={(e) => handlePeriodChange(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="today">Сегодня</option>
                <option value="yesterday">Вчера</option>
                <option value="week">Неделя</option>
                <option value="month">Месяц</option>
                <option value="quarter">Квартал</option>
                <option value="custom">Выбрать даты</option>
              </select>
            </div>

            {period === 'custom' && (
              <>
                <div className="flex-1 min-w-32">
                  <label className="block text-sm font-medium text-gray-700 mb-2">С:</label>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex-1 min-w-32">
                  <label className="block text-sm font-medium text-gray-700 mb-2">По:</label>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </>
            )}

            <div className="flex-1 min-w-48">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Filter className="inline w-4 h-4 mr-1" />
                Источники:
              </label>
              <div className="border border-gray-300 rounded-md p-3 max-h-40 overflow-y-auto bg-white">
                <label className="flex items-center mb-2 cursor-pointer hover:bg-gray-50 p-1 rounded transition-colors">
                  <input
                    type="checkbox"
                    checked={isAllSourcesSelected()}
                    onChange={() => handleSourceChange('all')}
                    className="mr-3 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <span className="text-sm font-medium text-gray-900">Все источники</span>
                </label>
                
                <hr className="my-2 border-gray-200" />
                
                {sources.map((source) => (
                  <label 
                    key={source._id} 
                    className="flex items-center mb-1 cursor-pointer hover:bg-gray-50 p-1 rounded transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={isSourceSelected(source.bitrixId)}
                      onChange={() => handleSourceChange(source.bitrixId)}
                      className="mr-3 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span 
                      className="text-sm text-gray-700 truncate flex-1" 
                      title={source.name}
                    >
                      {source.name}
                    </span>
                  </label>
                ))}
              </div>
              
              <div className="text-xs text-gray-500 mt-2">
                {isAllSourcesSelected() 
                  ? `Все источники (${sources.length})` 
                  : `Выбрано: ${selectedSources.length} из ${sources.length}`
                }
              </div>
            </div>

            <button
              onClick={handleRefresh}
              disabled={loading}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Обновить
            </button>
          </div>
        </div>

        {/* Статистика */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <div className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-blue-500">
            <div className="flex items-center">
              <div className="p-2 bg-blue-100 rounded-lg mr-4">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Всего лидов</p>
                <p className="text-2xl font-bold text-gray-900">{totalLeads.toLocaleString()}</p>
                {analytics?.note && (
                  <p className="text-xs text-gray-500">{analytics.note}</p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-green-500">
            <div className="flex items-center">
              <div className="p-2 bg-green-100 rounded-lg mr-4">
                <TrendingUp className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Источников</p>
                <p className="text-2xl font-bold text-gray-900">{totalSources}</p>
                <p className="text-xs text-gray-500">
                  {isAllSourcesSelected() ? 'Все источники' : 'Выбранные'}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-orange-500">
            <div className="flex items-center">
              <div className="p-2 bg-orange-100 rounded-lg mr-4">
                <CalendarIcon className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Встреч назначено</p>
                <p className="text-2xl font-bold text-gray-900">{totalMeetingsScheduled}</p>
                {totalLeads > 0 && (
                  <p className="text-xs text-gray-500">
                    {Math.round((totalMeetingsScheduled / totalLeads) * 100)}% конверсия
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-purple-500">
            <div className="flex items-center">
              <div className="p-2 bg-purple-100 rounded-lg mr-4">
                <BarChart3 className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Встреч состоялось</p>
                <p className="text-2xl font-bold text-gray-900">{totalMeetingsHeld}</p>
                {totalLeads > 0 && (
                  <p className="text-xs text-gray-500">
                    {Math.round((totalMeetingsHeld / totalLeads) * 100)}% конверсия
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Статус загрузки */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {getLoadingStatus()}
            </div>
            {analytics && (
              <div className="text-xs text-gray-500">
                Последнее обновление: {new Date().toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>

        {/* ТАБЛИЦА С ЗАКРЕПЛЕННЫМИ ЭЛЕМЕНТАМИ */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mr-3" />
              <span className="text-lg text-gray-600">Загрузка данных...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <p className="text-red-600 mb-2">{error}</p>
                <button
                  onClick={handleRefresh}
                  className="text-blue-600 hover:text-blue-800 underline"
                >
                  Попробовать снова
                </button>
              </div>
            </div>
          ) : sortedData.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-gray-500">Нет данных для отображения</p>
            </div>
          ) : (
            <div className="relative">
              <div 
                className="overflow-auto" 
                style={{ 
                  maxHeight: '600px',
                  scrollBehavior: 'smooth'
                }}
              >
                <table className="w-full border-collapse">
                  <thead 
                    className="bg-gray-50 sticky top-0 z-20"
                    style={{
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}
                  >
                    <tr>
                      <th 
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50 z-30 border-r border-gray-200"
                        style={{
                          minWidth: '200px',
                          boxShadow: '2px 0 4px rgba(0,0,0,0.1)'
                        }}
                      >
                        ID и название источника
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ minWidth: '120px' }}>
                        Количество лидов, шт
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ minWidth: '120px' }}>
                        Комм. установлена
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ minWidth: '90px' }}>
                        CR в комм.
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ minWidth: '120px' }}>
                        Назначено встреч
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ minWidth: '90px' }}>
                        CR в назначи.
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ minWidth: '120px' }}>
                        Состоялись встречи
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ minWidth: '90px' }}>
                        CR в состоявш.
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ minWidth: '150px' }}>
                        CR из назначенной в состоявш.
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ minWidth: '110px' }}>
                        Кол-во брака
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ minWidth: '90px' }}>
                        % в брак
                      </th>
                    </tr>
                  </thead>
                  
                  <tbody className="bg-white divide-y divide-gray-200">
                    {sortedData.map((item, index) => (
                      <tr 
                        key={item.sourceId} 
                        className={`${
                          index % 2 === 0 ? 'bg-white hover:bg-gray-50' : 'bg-gray-50 hover:bg-gray-100'
                        } transition-colors`}
                      >
                        <td 
                          className="px-6 py-4 whitespace-nowrap sticky left-0 bg-inherit z-10 border-r border-gray-200"
                          style={{
                            minWidth: '200px',
                            boxShadow: '2px 0 4px rgba(0,0,0,0.1)'
                          }}
                        >
                          <div className="text-sm font-medium text-gray-900">{item.sourceName}</div>
                          <div className="text-sm text-gray-500">{item.sourceId}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {item.totalLeads}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.comments}
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm ${getConversionColor(item.commentsConversion)}`}>
                          {item.commentsConversion}%
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.meetingsScheduled}
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm ${getConversionColor(item.meetingsScheduledConversion)}`}>
                          {item.meetingsScheduledConversion}%
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.meetingsHeld}
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm ${getConversionColor(item.meetingsHeldConversion)}`}>
                          {item.meetingsHeldConversion}%
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm ${getConversionColor(item.meetingsHeldFromScheduledConversion)}`}>
                          {item.meetingsHeldFromScheduledConversion}%
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.junk}
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm ${getConversionColor(item.junkPercent)}`}>
                          {item.junkPercent}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Debug информация */}
        {analytics?.debug && (
          <div className="mt-6 bg-gray-100 rounded-lg p-4">
            <details>
              <summary className="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                Debug информация 
                <span className="ml-2 text-xs bg-gray-200 px-2 py-1 rounded">
                  Время обработки: {analytics.processingTime}ms
                </span>
              </summary>
              <div className="mt-4 space-y-4">
                <div className="bg-white p-3 rounded border">
                  <h4 className="font-medium text-gray-800 mb-2">Краткая сводка:</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div>Всего лидов: <span className="font-medium">{analytics.totalLeads}</span></div>
                    <div>Встреч состоялось: <span className="font-medium">{analytics.totalMeetingsHeld}</span></div>
                    <div>Источников: <span className="font-medium">{analytics.data.length}</span></div>
                    <div>Период: <span className="font-medium">{analytics.debug.actualPeriod}</span></div>
                  </div>
                </div>
                
                {analytics.debug.meetingsBreakdown && analytics.debug.meetingsBreakdown.length > 0 && (
                  <div className="bg-white p-3 rounded border">
                    <h4 className="font-medium text-gray-800 mb-2">Детализация встреч по источникам:</h4>
                    <div className="space-y-1 text-xs">
                      {analytics.debug.meetingsBreakdown.map((item: any, index: number) => (
                        <div key={index} className="flex justify-between">
                          <span>{item.sourceName}:</span>
                          <span className="font-medium">
                            {item.meetingsHeld}/{item.totalLeads} 
                            <span className="text-gray-500 ml-1">({item.meetingsHeldConversion}%)</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                <details className="bg-white p-3 rounded border">
                  <summary className="cursor-pointer text-xs font-medium text-gray-700">
                    Полная debug информация
                  </summary>
                  <pre className="mt-2 text-xs text-gray-600 overflow-auto bg-gray-50 p-2 rounded">
                    {JSON.stringify(analytics.debug, null, 2)}
                  </pre>
                </details>
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
};

export default LeadsAnalyticsDashboard;
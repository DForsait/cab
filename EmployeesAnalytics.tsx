import React, { useState } from 'react';
import { Users, TrendingUp, Target, BarChart3, Loader2 } from 'lucide-react';

interface EmployeeData {
  employee: {
    id: string;
    name: string;
    email: string;
    position: string;
    active: boolean;
    totalLeads: number;
    totalMeetingsHeld: number;
    totalMeetingsScheduled: number;
    totalCommunication: number;
    totalJunk: number;
    overallConversion: string;
    meetingsFromScheduledConversion: string;
  };
  sources: Array<{
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
  }>;
}

interface EmployeesAnalyticsProps {
  selectedSources: string[];
  selectedPeriod: string;
  customStartDate: string;
  customEndDate: string;
}

const EmployeesAnalytics: React.FC<EmployeesAnalyticsProps> = ({ 
  selectedSources, 
  selectedPeriod, 
  customStartDate, 
  customEndDate 
}) => {
  const [employeesData, setEmployeesData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Функция загрузки аналитики сотрудников
  const loadEmployeesAnalytics = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Формируем URL с теми же параметрами что и основная таблица
      const params = new URLSearchParams();
      params.append('period', selectedPeriod);
      
      if (selectedPeriod === 'custom' && customStartDate && customEndDate) {
        params.append('startDate', customStartDate);
        params.append('endDate', customEndDate);
      }
      
      if (selectedSources && selectedSources.length > 0) {
        params.append('sourceId', selectedSources.join(','));
      }
      
      console.log('🔍 Загрузка аналитики сотрудников с параметрами:', params.toString());
      
      const response = await fetch(`/api/dashboard/employees-analytics?${params}`);
      const data = await response.json();
      
      if (data.success) {
        setEmployeesData(data);
        setShowAnalytics(true);
        console.log('✅ Аналитика сотрудников загружена:', data);
      } else {
        throw new Error(data.error || 'Ошибка загрузки аналитики сотрудников');
      }
    } catch (err: any) {
      console.error('❌ Ошибка загрузки аналитики сотрудников:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Функция скрытия аналитики
  const hideAnalytics = () => {
    setShowAnalytics(false);
    setEmployeesData(null);
  };

  // Функция получения цвета для конверсии
  const getConversionColor = (conversion: string) => {
    const value = parseFloat(conversion);
    if (value >= 20) return 'text-green-600 bg-green-50';
    if (value >= 10) return 'text-orange-600 bg-orange-50';
    return 'text-red-600 bg-red-50';
  };

  // Кнопка загрузки аналитики
  if (!showAnalytics) {
    return (
      <div className="mt-8 bg-white rounded-lg shadow-sm border p-6">
        <div className="text-center">
          <Users className="mx-auto h-12 w-12 text-blue-500 mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Аналитика по контакт-центру
          </h3>
          <p className="text-gray-600 mb-6">
            Получите детальную статистику работы каждого сотрудника с разбивкой по источникам трафика
          </p>
          
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}
          
          <button
            onClick={loadEmployeesAnalytics}
            disabled={loading}
            className="inline-flex items-center px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg transition-colors"
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin -ml-1 mr-2 h-5 w-5" />
                Загружаем аналитику...
              </>
            ) : (
              <>
                <BarChart3 className="-ml-1 mr-2 h-5 w-5" />
                Получить аналитику по КЦ
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // Отображение аналитики
  return (
    <div className="mt-8 space-y-6">
      {/* Заголовок с общей статистикой */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <Users className="h-6 w-6 text-blue-500 mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">
              Аналитика по контакт-центру
            </h3>
          </div>
          <button
            onClick={hideAnalytics}
            className="text-gray-500 hover:text-gray-700 text-sm"
          >
            Скрыть
          </button>
        </div>
        
        {/* Общая статистика */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="flex items-center">
              <Users className="h-5 w-5 text-blue-600 mr-2" />
              <div>
                <p className="text-sm text-blue-600">Сотрудников</p>
                <p className="text-2xl font-bold text-blue-900">{employeesData?.totalEmployees || 0}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="flex items-center">
              <Target className="h-5 w-5 text-green-600 mr-2" />
              <div>
                <p className="text-sm text-green-600">Всего лидов</p>
                <p className="text-2xl font-bold text-green-900">{employeesData?.totalLeads || 0}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-purple-50 p-4 rounded-lg">
            <div className="flex items-center">
              <TrendingUp className="h-5 w-5 text-purple-600 mr-2" />
              <div>
                <p className="text-sm text-purple-600">Встреч состоялось</p>
                <p className="text-2xl font-bold text-purple-900">{employeesData?.totalMeetingsHeld || 0}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-orange-50 p-4 rounded-lg">
            <div className="flex items-center">
              <BarChart3 className="h-5 w-5 text-orange-600 mr-2" />
              <div>
                <p className="text-sm text-orange-600">Средняя конверсия</p>
                <p className="text-2xl font-bold text-orange-900">{employeesData?.averageConversion || 0}%</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Таблицы для каждого сотрудника */}
      {employeesData?.data?.map((employeeData: EmployeeData) => (
        <div key={employeeData.employee.id} className="bg-white rounded-lg shadow-sm border overflow-hidden">
          {/* Заголовок сотрудника */}
          <div className="bg-gray-50 px-6 py-4 border-b">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-lg font-semibold text-gray-900">
                  👤 {employeeData.employee.name}
                </h4>
                <p className="text-sm text-gray-600 mt-1">
                  {employeeData.employee.position && (
                    <span className="mr-4">{employeeData.employee.position}</span>
                  )}
                  Всего: {employeeData.employee.totalLeads} лидов • 
                  {employeeData.employee.totalMeetingsHeld} встреч • 
                  {employeeData.employee.overallConversion}% общая конверсия
                </p>
              </div>
              <div className="text-right">
                <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getConversionColor(employeeData.employee.overallConversion)}`}>
                  {employeeData.employee.overallConversion}% CR
                </div>
              </div>
            </div>
          </div>

          {/* Таблица источников сотрудника */}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50 z-10">
                    Источник трафика
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Количество лидов, шт
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Комм. установлена
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    CR в комм.
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Назначено встреч
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    CR в назначи.
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Состоялись встречи
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    CR в состоявш.
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    CR из назначенной в состоявш.
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Кол-во брака
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    % в брак
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {employeeData.sources.map((source, sourceIndex) => (
                  <tr key={source.sourceId} className={sourceIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 sticky left-0 bg-inherit z-10 font-medium">
                      <div>
                        <div className="text-xs text-gray-500">{source.sourceId}</div>
                        <div className="font-medium">{source.sourceName}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-center">
                      {source.totalLeads}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-center">
                      {source.comments}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getConversionColor(source.commentsConversion)}`}>
                        {source.commentsConversion}%
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-center">
                      {source.meetingsScheduled}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getConversionColor(source.meetingsScheduledConversion)}`}>
                        {source.meetingsScheduledConversion}%
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-center">
                      {source.meetingsHeld}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getConversionColor(source.meetingsHeldConversion)}`}>
                        {source.meetingsHeldConversion}%
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getConversionColor(source.meetingsHeldFromScheduledConversion)}`}>
                        {source.meetingsHeldFromScheduledConversion}%
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-center">
                      {source.junk}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${source.junkPercent > '30' ? 'text-red-600 bg-red-50' : source.junkPercent > '15' ? 'text-orange-600 bg-orange-50' : 'text-green-600 bg-green-50'}`}>
                        {source.junkPercent}%
                      </span>
                    </td>
                  </tr>
                ))}
                
                {/* Итоговая строка для сотрудника */}
                <tr className="bg-blue-50 font-semibold">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-900 sticky left-0 bg-blue-50 z-10">
                    ИТОГО по сотруднику
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-900 text-center">
                    {employeeData.employee.totalLeads}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-900 text-center">
                    {employeeData.employee.totalCommunication}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-blue-600 bg-blue-100">
                      {employeeData.employee.totalLeads > 0 ? ((employeeData.employee.totalCommunication / employeeData.employee.totalLeads) * 100).toFixed(1) : 0}%
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-900 text-center">
                    {employeeData.employee.totalMeetingsScheduled}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-blue-600 bg-blue-100">
                      {employeeData.employee.totalLeads > 0 ? ((employeeData.employee.totalMeetingsScheduled / employeeData.employee.totalLeads) * 100).toFixed(1) : 0}%
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-900 text-center">
                    {employeeData.employee.totalMeetingsHeld}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-blue-600 bg-blue-100">
                      {employeeData.employee.overallConversion}%
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-blue-600 bg-blue-100">
                      {employeeData.employee.meetingsFromScheduledConversion}%
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-900 text-center">
                    {employeeData.employee.totalJunk}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-blue-600 bg-blue-100">
                      {employeeData.employee.totalLeads > 0 ? ((employeeData.employee.totalJunk / employeeData.employee.totalLeads) * 100).toFixed(1) : 0}%
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
      
      {/* Кнопка скрытия внизу */}
      <div className="text-center">
        <button
          onClick={hideAnalytics}
          className="text-gray-500 hover:text-gray-700 text-sm underline"
        >
          Скрыть аналитику по КЦ
        </button>
      </div>
    </div>
  );
};

export default EmployeesAnalytics;
import clsx from 'clsx';

const STATUS_STYLES = {
  // Requirements
  'Pending Review':         'bg-yellow-50 text-yellow-700 border-yellow-100',
  'Operations Review':      'bg-blue-50 text-blue-700 border-blue-100',
  'Quotation In Progress':  'bg-purple-50 text-purple-700 border-purple-100',
  'Quoted':                 'bg-indigo-50 text-indigo-700 border-indigo-100',
  'Approved':               'bg-green-50 text-green-700 border-green-100',
  'Rejected':               'bg-red-50 text-red-700 border-red-100',
  'Completed':              'bg-gray-100 text-gray-600 border-gray-200',
  'Cancelled':              'bg-gray-100 text-gray-500 border-gray-200',
  // Equipment
  'Available':              'bg-green-50 text-green-700 border-green-100',
  'Reserved':               'bg-yellow-50 text-yellow-700 border-yellow-100',
  'Dispatched':             'bg-blue-50 text-blue-700 border-blue-100',
  'Maintenance':            'bg-red-50 text-red-700 border-red-100',
  'Retired':                'bg-gray-100 text-gray-500 border-gray-200',
  // Dispatch
  'Pending':                'bg-yellow-50 text-yellow-700 border-yellow-100',
  'Assigned':               'bg-blue-50 text-blue-700 border-blue-100',
  'In Transit':             'bg-purple-50 text-purple-700 border-purple-100',
  // Quotations
  'Draft':                  'bg-gray-100 text-gray-600 border-gray-200',
  'Sent':                   'bg-blue-50 text-blue-700 border-blue-100',
  'Expired':                'bg-red-50 text-red-600 border-red-100',
  'Invoiced':               'bg-green-50 text-green-700 border-green-100',
  // Maintenance
  'Open':                   'bg-red-50 text-red-700 border-red-100',
  'In Progress':            'bg-yellow-50 text-yellow-700 border-yellow-100',
  // Finance
  'Paid':                   'bg-green-50 text-green-700 border-green-100',
  'Overdue':                'bg-red-50 text-red-700 border-red-100',
  // Priority
  'Low':                    'bg-gray-100 text-gray-500 border-gray-200',
  'Normal':                 'bg-blue-50 text-blue-600 border-blue-100',
  'High':                   'bg-orange-50 text-orange-700 border-orange-100',
  'Urgent':                 'bg-red-50 text-red-700 border-red-100',
};

export default function StatusBadge({ status }) {
  return (
    <span className={clsx(
      'badge border text-xs font-medium',
      STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-500 border-gray-200'
    )}>
      {status}
    </span>
  );
}
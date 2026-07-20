export interface ResourceColumn<T> {
  header: string;
  render: (item: T) => React.ReactNode;
}

export function ResourceTable<T>({ columns, items, empty }: Readonly<{
  columns: ResourceColumn<T>[];
  items: T[];
  empty: string;
}>) {
  if (items.length === 0) {
    return <p className="empty-state">{empty}</p>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column.header}>{column.header}</th>)}</tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={index}>
              {columns.map((column) => <td key={column.header}>{column.render(item)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

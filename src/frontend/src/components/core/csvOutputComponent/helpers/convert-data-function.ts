export const convertCSVToData = (
  csvFile: { data: string },
  csvSeparator: string,
) => {
  const lines = csvFile.data.trim().split("\n");
  const headers = lines[0].trim().split(csvSeparator);

  const initialRowData: Array<Record<string, string | number>> = [];
  const initialColDefs = headers.map((header) => ({
    field: header.trim(),
    wrapText: true,
    autoHeight: true,
    height: "100%",
  }));

  for (let i = 1; i < lines.length; i++) {
    const data = lines[i].trim().split(csvSeparator);
    const rowDataEntry: Record<string, string | number> = {};

    for (let j = 0; j < headers.length; j++) {
      const value = Number.isNaN(Number(data[j]))
        ? data[j]
        : Number.parseFloat(data[j]);
      rowDataEntry[headers[j].trim()] = value;
    }

    initialRowData.push(rowDataEntry);
  }

  return { rowData: initialRowData, colDefs: initialColDefs };
};

interface QueryParams {
  [key: string]: string | number | boolean | null | undefined;
}

const buildQueryStringUrl = (baseUrl: string, params: QueryParams): string => {
  const queryParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      if (typeof value === "boolean") {
        queryParams.append(key, value ? "true" : "false");
      } else if (value !== null) {
        queryParams.append(key, String(value));
      }
    }
  });

  const queryString = queryParams.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
};

export default buildQueryStringUrl;

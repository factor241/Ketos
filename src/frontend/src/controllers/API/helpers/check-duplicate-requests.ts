import { AUTHORIZED_DUPLICATE_REQUESTS } from "../../../constants/constants";

type DuplicateRequestConfig = {
  method?: string;
  url?: string;
};

let lastUrl = "";
let lastMethodCalled = "";
let lastRequestTime = 0;
let lastCurrentUrl = "";

export function checkDuplicateRequestAndStoreRequest(
  config: DuplicateRequestConfig,
) {
  const currentUrl = window.location.pathname;
  const currentTime = Date.now();
  const isContained = AUTHORIZED_DUPLICATE_REQUESTS.some((request) =>
    config.url?.includes(request),
  );

  if (
    config.url === lastUrl &&
    !isContained &&
    lastMethodCalled === config.method &&
    lastMethodCalled === "get" && // Assuming you want to check only for GET requests
    lastRequestTime &&
    currentTime - lastRequestTime < 300 &&
    lastCurrentUrl === currentUrl
  ) {
    throw new Error("Duplicate request: " + lastUrl);
  }

  lastUrl = config.url ?? "";
  lastMethodCalled = config.method ?? "";
  lastRequestTime = currentTime;
  lastCurrentUrl = currentUrl;
}

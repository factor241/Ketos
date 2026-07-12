import { AUTHORIZED_DUPLICATE_REQUESTS } from "../../../constants/constants";

export function checkDuplicateRequestAndStoreRequest(config) {
  const lastUrl = localStorage.getItem("ketos-last-url-called");
  const lastMethodCalled = localStorage.getItem("ketos-last-method-called");
  const lastRequestTime = localStorage.getItem("ketos-last-request-time");
  const lastCurrentUrl = localStorage.getItem("ketos-last-current-url");

  const currentUrl = window.location.pathname;
  const currentTime = Date.now();
  const isContained = AUTHORIZED_DUPLICATE_REQUESTS.some((request) =>
    config?.url!.includes(request),
  );

  if (
    config?.url === lastUrl &&
    !isContained &&
    lastMethodCalled === config.method &&
    lastMethodCalled === "get" && // Assuming you want to check only for GET requests
    lastRequestTime &&
    currentTime - parseInt(lastRequestTime, 10) < 300 &&
    lastCurrentUrl === currentUrl
  ) {
    throw new Error("Duplicate request: " + lastUrl);
  }

  localStorage.setItem("ketos-last-url-called", config.url ?? "");
  localStorage.setItem("ketos-last-method-called", config.method ?? "");
  localStorage.setItem("ketos-last-request-time", currentTime.toString());
  localStorage.setItem("ketos-last-current-url", currentUrl);
}

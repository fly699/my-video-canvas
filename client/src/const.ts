export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Always redirect to the local login page; users can choose email or OAuth from there.
export const getLoginUrl = (): string => "/login";

import type { IncomingMessage } from "node:http";

export type UpstreamCredentialHeaders = Readonly<
	Partial<Record<"Authorization" | "Cookie", string>>
>;

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9._~+/-]+={0,2})$/i;
const ACCESS_COOKIE_PATTERN = /^[A-Za-z0-9._~-]{1,8192}$/;

export function selectUpstreamCredentialHeaders(
	headers: Headers,
): UpstreamCredentialHeaders {
	const authorization = headers.get("authorization");
	if (authorization !== null) {
		const match = BEARER_PATTERN.exec(authorization.trim());
		return match?.[1] === undefined
			? {}
			: { Authorization: `Bearer ${match[1]}` };
	}

	const cookieHeader = headers.get("cookie");
	if (cookieHeader === null) {
		return {};
	}

	const accessValues = cookieHeader
		.split(";")
		.map((part) => part.trim())
		.filter((part) => part.startsWith("access_token_lf="))
		.map((part) => part.slice("access_token_lf=".length));
	if (
		accessValues.length !== 1 ||
		accessValues[0] === undefined ||
		!ACCESS_COOKIE_PATTERN.test(accessValues[0])
	) {
		return {};
	}

	return { Cookie: `access_token_lf=${accessValues[0]}` };
}

export function sanitizeIncomingCredentials(request: IncomingMessage): void {
	const headers = new Headers();
	for (const [name, value] of Object.entries(request.headers)) {
		if (Array.isArray(value)) {
			for (const entry of value) {
				headers.append(name, entry);
			}
		} else if (value !== undefined) {
			headers.set(name, value);
		}
	}
	const selected = selectUpstreamCredentialHeaders(headers);

	delete request.headers.authorization;
	delete request.headers.cookie;
	delete request.headers["x-api-key"];
	delete request.headers.api_key;

	if (selected.Authorization !== undefined) {
		request.headers.authorization = selected.Authorization;
	} else if (selected.Cookie !== undefined) {
		request.headers.cookie = selected.Cookie;
	}
}

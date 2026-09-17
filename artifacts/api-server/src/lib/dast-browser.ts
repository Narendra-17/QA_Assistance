import { logger } from "./logger";
import type { Browser, ConsoleMessage, HTTPRequest } from "puppeteer";

export interface DastBrowserCapture {
  renderedHtml: string;
  networkRequests: string[];
  cookies: Array<{ name: string; domain: string; httpOnly: boolean; secure: boolean }>;
  consoleErrors: string[];
  pageErrors: string[];
  localStorageKeys: string[];
  sessionStorageKeys: string[];
  inlineHandlers: string[];
  forms: Array<{ action: string; method: string; inputs: string[] }>;
  externalScripts: string[];
  title: string;
  meta: Record<string, string>;
}

const BROWSER_TIMEOUT_MS = 45_000;

export async function captureDastBrowser(appUrl: string): Promise<DastBrowserCapture | null> {
  let browser: Browser | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const puppeteerModule = await import("puppeteer");
    const puppeteer = puppeteerModule.default;
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    const networkRequests = new Set<string>();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("request", (request: HTTPRequest) => networkRequests.add(request.url()));
    page.on("console", (message: ConsoleMessage) => {
      if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500));
    });
    page.on("pageerror", error => pageErrors.push(String(error).slice(0, 500)));

    const capture = (async () => {
      await page.goto(appUrl, { waitUntil: "networkidle2", timeout: BROWSER_TIMEOUT_MS });
      const renderedHtml = await page.content();
      const browserData = await page.evaluate(`() => {
        const forms = Array.from(document.forms).map(form => ({
          action: form.action,
          method: form.method || "get",
          inputs: Array.from(form.elements).map(element => element.name || element.id).filter(Boolean),
        }));
        const inlineHandlers = Array.from(document.querySelectorAll("*"))
          .flatMap(element => Array.from(element.attributes)
            .filter(attribute => attribute.name.startsWith("on") || attribute.value.startsWith("javascript:"))
            .map(attribute => attribute.name + "=" + attribute.value))
          .slice(0, 100);
        const meta = {};
        document.querySelectorAll("meta").forEach(element => {
          const key = element.getAttribute("name") || element.getAttribute("property");
          const value = element.getAttribute("content");
          if (key && value) meta[key] = value.slice(0, 500);
        });
        return {
          localStorageKeys: Object.keys(localStorage),
          sessionStorageKeys: Object.keys(sessionStorage),
          inlineHandlers,
          forms,
          externalScripts: Array.from(document.scripts).map(script => script.src).filter(Boolean).slice(0, 100),
          title: document.title,
          meta,
        };
      }`) as {
        localStorageKeys: string[];
        sessionStorageKeys: string[];
        inlineHandlers: string[];
        forms: Array<{ action: string; method: string; inputs: string[] }>;
        externalScripts: string[];
        title: string;
        meta: Record<string, string>;
      };
      const cookies = (await page.cookies()).map(cookie => ({
        name: cookie.name,
        domain: cookie.domain,
        httpOnly: cookie.httpOnly ?? false,
        secure: cookie.secure,
      }));
      return { renderedHtml, networkRequests: [...networkRequests].slice(0, 300), cookies, consoleErrors, pageErrors, ...browserData };
    })();
    timer = setTimeout(() => {
      void browser?.close();
    }, BROWSER_TIMEOUT_MS + 2_000);
    return await Promise.race([
      capture,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("browser capture timed out")), BROWSER_TIMEOUT_MS + 2_500)),
    ]);
  } catch (error) {
    logger.warn({ appUrl, err: error instanceof Error ? error.message : String(error) }, "Headless DAST capture unavailable; using static fetch");
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    await browser?.close().catch(() => undefined);
  }
}
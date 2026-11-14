// Agent Bridge MCP - Viewport, Device Emulation, Screenshots & PDF (ES Module)
import { attachDebuggerIfNeeded } from "../core/cdp.js";
import { resolveElementInfo } from "../ui/dom.js";

export const emulationActions = {
  async resize_page(params) {
    await attachDebuggerIfNeeded(params.tabId);
    const width = params.width || 1280;
    const height = params.height || 800;
    const deviceScaleFactor = params.deviceScaleFactor || 1;
    const mobile = params.mobile || false;
    await chrome.debugger.sendCommand(
      { tabId: params.tabId },
      "Emulation.setDeviceMetricsOverride",
      {
        width,
        height,
        deviceScaleFactor,
        mobile,
      }
    );
    return { success: true, width, height, viewport: { width, height, deviceScaleFactor, mobile } };
  },

  async emulate(params) {
    await attachDebuggerIfNeeded(params.tabId);

    if (params.colorScheme) {
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: params.colorScheme }],
      });
    }

    if (params.userAgent) {
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Network.setUserAgentOverride", {
        userAgent: params.userAgent,
      });
    }

    if (params.cpuThrottlingRate) {
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Emulation.setCPUThrottlingRate", {
        rate: Number(params.cpuThrottlingRate),
      });
    }

    if (params.geolocation) {
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Emulation.setGeolocationOverride", {
        latitude: params.geolocation.latitude,
        longitude: params.geolocation.longitude,
        accuracy: params.geolocation.accuracy || 100,
      });
    }

    if (params.networkConditions) {
      const presets = {
        offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
        slow3g: { offline: false, latency: 400, downloadThroughput: 500 * 1024 / 8, uploadThroughput: 500 * 1024 / 8 },
        fast3g: { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 },
        "4g": { offline: false, latency: 20, downloadThroughput: 4 * 1024 * 1024 / 8, uploadThroughput: 3 * 1024 * 1024 / 8 },
      };
      const preset = typeof params.networkConditions === "string" ? presets[params.networkConditions.toLowerCase()] : params.networkConditions;
      if (preset) {
        await chrome.debugger.sendCommand({ tabId: params.tabId }, "Network.emulateNetworkConditions", {
          offline: preset.offline || false,
          latency: preset.latency || 0,
          downloadThroughput: preset.downloadThroughput || -1,
          uploadThroughput: preset.uploadThroughput || -1,
        });
      }
    }

    return { success: true, emulated: true, params };
  },

  async emulate_timezone(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    if (!params.timezoneId) throw new Error("Missing required timezoneId parameter (e.g. 'America/New_York')");
    let cdpSuccess = false;
    try {
      await attachDebuggerIfNeeded(params.tabId);
      await chrome.debugger.sendCommand({ tabId: params.tabId }, "Emulation.setTimezoneOverride", {
        timezoneId: params.timezoneId,
      });
      cdpSuccess = true;
    } catch {
      // Fall back to script-level Intl.DateTimeFormat override
      await chrome.scripting.executeScript({
        target: { tabId: params.tabId },
        args: [params.timezoneId],
        func: (tz) => {
          try {
            const OrigDateTimeFormat = Intl.DateTimeFormat;
            Intl.DateTimeFormat = function (...args) {
              const instance = new OrigDateTimeFormat(...args);
              const origResolved = instance.resolvedOptions.bind(instance);
              instance.resolvedOptions = () => Object.assign(origResolved(), { timeZone: tz });
              return instance;
            };
            window.__emulatedTimezone = tz;
          } catch {}
        },
      });
    }
    return { success: true, tabId: params.tabId, timezoneId: params.timezoneId, mode: cdpSuccess ? "cdp" : "dom_emulation" };
  },

  async screenshot(params) {
    await attachDebuggerIfNeeded(params.tabId);
    const format = params.format === "jpeg" ? "jpeg" : "png";
    const quality = params.quality || (format === "jpeg" ? 80 : undefined);
    const captureParams = { format };
    if (quality !== undefined) captureParams.quality = quality;

    if (params.fullPage) {
      captureParams.captureBeyondViewport = true;
    }

    if (params.target) {
      const info = await resolveElementInfo(params.tabId, params.target);
      if (!info) {
        throw new Error(`Target element "${params.target}" not found for screenshot.`);
      }
      captureParams.clip = {
        x: info.rect.x,
        y: info.rect.y,
        width: info.rect.width,
        height: info.rect.height,
        scale: 1,
      };
    }

    const { data } = await chrome.debugger.sendCommand(
      { tabId: params.tabId },
      "Page.captureScreenshot",
      captureParams
    );

    return {
      tabId: params.tabId,
      format,
      dataBase64: data,
      mimeType: `image/${format}`,
      fullPage: Boolean(params.fullPage),
      target: params.target || null,
    };
  },

  async print_to_pdf(params) {
    await attachDebuggerIfNeeded(params.tabId);
    const pdfOptions = {
      landscape: params.landscape ?? false,
      displayHeaderFooter: params.displayHeaderFooter ?? false,
      printBackground: params.printBackground ?? true,
      scale: params.scale ?? 1,
      paperWidth: params.paperWidth ?? 8.5,
      paperHeight: params.paperHeight ?? 11,
      marginTop: params.marginTop ?? 0.4,
      marginBottom: params.marginBottom ?? 0.4,
      marginLeft: params.marginLeft ?? 0.4,
      marginRight: params.marginRight ?? 0.4,
      pageRanges: params.pageRanges || undefined,
      preferCSSPageSize: params.preferCSSPageSize ?? false,
    };

    const { data } = await chrome.debugger.sendCommand(
      { tabId: params.tabId },
      "Page.printToPDF",
      pdfOptions
    );

    return {
      tabId: params.tabId,
      mimeType: "application/pdf",
      dataBase64: data,
    };
  },
};

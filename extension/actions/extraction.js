// Agent Bridge MCP - Smart Content, Markdown & Table Extraction (ES Module)
import { injectAgentVisualCue } from "../ui/hud.js";

export const extractionActions = {
  async get_markdown(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: params.tabId },
      args: [
        params.selector || null,
        params.includeLinks ?? true,
        params.includeImages ?? false,
        params.maxLength ?? 50000,
      ],
      func: (selector, includeLinks, includeImages, maxLength) => {
        let root = null;
        if (selector) {
          if (selector.startsWith("ref_") || selector.startsWith("ref-")) {
            root = document.querySelector(`[data-agent-ref="${selector}"]`);
          } else {
            try {
              root = document.querySelector(selector);
            } catch {
              root = document.querySelector(`[data-agent-ref="${selector}"]`);
            }
          }
        }
        if (!root) root = document.body || document.documentElement;

        function nodeToMarkdown(node) {
          if (!node) return "";
          if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent.replace(/\s+/g, " ");
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return "";

          const tag = node.tagName.toLowerCase();
          const style = window.getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden") return "";
          if (["script", "style", "noscript", "svg", "canvas"].includes(tag)) return "";

          let inner = "";
          for (const child of node.childNodes) {
            inner += nodeToMarkdown(child);
          }
          inner = inner.trim();

          switch (tag) {
            case "h1":
              return `\n\n# ${inner}\n\n`;
            case "h2":
              return `\n\n## ${inner}\n\n`;
            case "h3":
              return `\n\n### ${inner}\n\n`;
            case "h4":
              return `\n\n#### ${inner}\n\n`;
            case "h5":
            case "h6":
              return `\n\n##### ${inner}\n\n`;
            case "p":
              return `\n\n${inner}\n\n`;
            case "br":
              return `\n`;
            case "hr":
              return `\n\n---\n\n`;
            case "strong":
            case "b":
              return `**${inner}**`;
            case "em":
            case "i":
              return `*${inner}*`;
            case "code":
              return `\`${inner}\``;
            case "pre":
              return `\n\n\`\`\`\n${node.innerText || inner}\n\`\`\`\n\n`;
            case "blockquote":
              return `\n\n> ${inner.replace(/\n/g, "\n> ")}\n\n`;
            case "a": {
              const href = node.getAttribute("href");
              if (includeLinks && href && href !== "#" && !href.startsWith("javascript:")) {
                try {
                  const absolute = new URL(href, location.href).href;
                  return `[${inner || absolute}](${absolute})`;
                } catch {
                  return `[${inner}](${href})`;
                }
              }
              return inner;
            }
            case "img": {
              if (!includeImages) return "";
              const src = node.getAttribute("src");
              const alt = node.getAttribute("alt") || "Image";
              if (src) {
                try {
                  const abs = new URL(src, location.href).href;
                  return `![${alt}](${abs})`;
                } catch {
                  return `![${alt}](${src})`;
                }
              }
              return "";
            }
            case "ul":
              return `\n\n${inner}\n\n`;
            case "ol":
              return `\n\n${inner}\n\n`;
            case "li":
              return `* ${inner}\n`;
            default:
              return inner ? ` ${inner} ` : "";
          }
        }

        let md = nodeToMarkdown(root)
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        let truncated = false;
        if (md.length > maxLength) {
          md = md.slice(0, maxLength) + `\n\n... [Truncated: ${md.length - maxLength} more characters]`;
          truncated = true;
        }

        const wordCount = md.split(/\s+/).filter(Boolean).length;
        return {
          title: document.title,
          url: location.href,
          markdown: md,
          characterCount: md.length,
          wordCount,
          truncated,
        };
      },
    });

    await injectAgentVisualCue(params.tabId, {
      label: `Markdown Extracted (${result.wordCount} words)`,
    });

    return { success: true, tabId: params.tabId, ...result };
  },

  async extract_table(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: params.tabId },
      args: [params.target || null, params.format || "json"],
      func: (target, format) => {
        let tableElements = [];
        if (target) {
          if (typeof target === "string" && target.startsWith("ref_")) {
            const el = document.querySelector(`[data-agent-ref="${target}"]`);
            if (el) tableElements = el.tagName.toLowerCase() === "table" ? [el] : Array.from(el.querySelectorAll("table"));
          } else {
            const el = document.querySelector(target);
            if (el) tableElements = el.tagName.toLowerCase() === "table" ? [el] : Array.from(el.querySelectorAll("table"));
          }
        }
        if (!tableElements.length) {
          tableElements = Array.from(document.querySelectorAll("table, [role='table'], [role='grid']"));
        }

        if (!tableElements.length) {
          return { count: 0, tables: [], message: "No tables found on page." };
        }

        const results = [];
        tableElements.forEach((tbl, tblIdx) => {
          const rows = Array.from(tbl.querySelectorAll("tr"));
          if (!rows.length) return;

          let headerCells = Array.from(rows[0].querySelectorAll("th"));
          let dataRowStart = 1;
          if (!headerCells.length) {
            headerCells = Array.from(rows[0].querySelectorAll("td"));
            dataRowStart = 1;
          }

          const headers = headerCells.map((c, i) => c.textContent.trim().replace(/\s+/g, " ") || `col_${i + 1}`);

          const parsedRows = [];
          for (let r = dataRowStart; r < rows.length; r++) {
            const cells = Array.from(rows[r].querySelectorAll("th, td"));
            if (!cells.length) continue;
            const rowObj = {};
            const rowArr = [];
            cells.forEach((cell, cIdx) => {
              const key = headers[cIdx] || `col_${cIdx + 1}`;
              const text = cell.textContent.trim().replace(/\s+/g, " ");
              const link = cell.querySelector("a[href]");
              const val = link ? { text, href: link.href } : text;
              rowObj[key] = val;
              rowArr.push(text);
            });
            parsedRows.push({ obj: rowObj, raw: rowArr });
          }

          let formattedOutput = null;
          if (format === "csv") {
            const escapeCsv = (val) => {
              const s = typeof val === "object" ? val.text : String(val);
              return `"${s.replace(/"/g, '""')}"`;
            };
            const csvLines = [headers.map(escapeCsv).join(",")];
            parsedRows.forEach((r) => {
              csvLines.push(headers.map((h) => escapeCsv(r.obj[h] || "")).join(","));
            });
            formattedOutput = csvLines.join("\n");
          } else if (format === "markdown") {
            let md = `| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |\n`;
            parsedRows.forEach((r) => {
              md += `| ${headers.map((h) => (typeof r.obj[h] === "object" ? r.obj[h].text : r.obj[h] || "").replace(/\|/g, "\\|")).join(" | ")} |\n`;
            });
            formattedOutput = md;
          } else {
            formattedOutput = parsedRows.map((r) => r.obj);
          }

          results.push({
            index: tblIdx,
            id: tbl.id || null,
            caption: tbl.querySelector("caption")?.textContent.trim() || null,
            headers,
            rowCount: parsedRows.length,
            data: formattedOutput,
          });
        });

        return { count: results.length, tables: results };
      },
    });

    await injectAgentVisualCue(params.tabId, {
      label: `Table Extracted (${result.count} table${result.count === 1 ? "" : "s"})`,
    });

    return { success: true, tabId: params.tabId, ...result };
  },

  async find_in_page(params) {
    if (!params.tabId) throw new Error("Missing required tabId parameter");
    if (!params.query) throw new Error("Missing required query parameter");

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: params.tabId },
      args: [
        params.query,
        params.caseSensitive ?? false,
        params.matchIndex ?? 0,
        params.scrollToMatch ?? true,
      ],
      func: (query, caseSensitive, matchIndex, scrollToMatch) => {
        const textNodes = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while ((node = walker.nextNode())) {
          const parent = node.parentElement;
          if (!parent) continue;
          const tag = parent.tagName.toLowerCase();
          if (["script", "style", "noscript"].includes(tag)) continue;
          const style = window.getComputedStyle(parent);
          if (style.display === "none" || style.visibility === "hidden") continue;
          textNodes.push(node);
        }

        const flags = caseSensitive ? "g" : "gi";
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(escapedQuery, flags);
        const matches = [];

        textNodes.forEach((tNode) => {
          const text = tNode.nodeValue;
          let m;
          while ((m = regex.exec(text)) !== null) {
            const parent = tNode.parentElement;
            const rect = parent ? parent.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
            const start = Math.max(0, m.index - 35);
            const end = Math.min(text.length, m.index + query.length + 35);
            matches.push({
              index: matches.length,
              snippet: text.slice(start, end).replace(/\s+/g, " "),
              matchedText: m[0],
              parentTag: parent ? parent.tagName.toLowerCase() : null,
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2),
              rect: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
            });
          }
        });

        let scrolledMatch = null;
        if (scrollToMatch && matches.length > 0) {
          const targetIdx = Math.min(Math.max(0, matchIndex), matches.length - 1);
          scrolledMatch = matches[targetIdx];
          window.scrollTo({
            left: 0,
            top: Math.max(0, scrolledMatch.rect.y + window.scrollY - window.innerHeight / 2),
            behavior: "smooth",
          });
        }

        return {
          query,
          totalMatches: matches.length,
          matches: matches.slice(0, 50),
          scrolledTarget: scrolledMatch || null,
        };
      },
    });

    if (result.scrolledTarget) {
      await injectAgentVisualCue(params.tabId, {
        type: "click",
        x: result.scrolledTarget.x,
        y: result.scrolledTarget.y,
        rect: result.scrolledTarget.rect,
        label: `Found "${params.query}" (${result.totalMatches} matches)`,
      });
    } else {
      await injectAgentVisualCue(params.tabId, {
        label: `Find "${params.query}": ${result.totalMatches} matches`,
      });
    }

    return { success: true, tabId: params.tabId, ...result };
  },
};

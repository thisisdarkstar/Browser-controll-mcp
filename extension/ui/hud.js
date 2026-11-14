// Agent Bridge MCP - UI & Visual Action HUD Overlay (ES Module)

export async function injectAgentVisualCue(tabId, cue) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [cue],
      func: (data) => {
        if (!document || !document.body) return;

        // 1. Inject Hardware-Accelerated CSS Keyframes
        if (!document.getElementById("__agent_hud_styles")) {
          const styleTag = document.createElement("style");
          styleTag.id = "__agent_hud_styles";
          styleTag.textContent = `
            @keyframes agentPulseGlow {
              0%, 100% { box-shadow: 0 0 16px rgba(0, 229, 255, 0.8), inset 0 0 8px rgba(0, 229, 255, 0.4); }
              50% { box-shadow: 0 0 28px rgba(0, 229, 255, 1), inset 0 0 14px rgba(0, 229, 255, 0.7); }
            }
            @keyframes agentChevronDown {
              0% { transform: translateY(-8px); opacity: 0; }
              50% { opacity: 1; }
              100% { transform: translateY(10px); opacity: 0; }
            }
            @keyframes agentChevronUp {
              0% { transform: translateY(8px); opacity: 0; }
              50% { opacity: 1; }
              100% { transform: translateY(-10px); opacity: 0; }
            }
            @keyframes agentNavProgress {
              0% { width: 0%; opacity: 1; }
              60% { width: 75%; opacity: 1; }
              90% { width: 95%; opacity: 1; }
              100% { width: 100%; opacity: 0; }
            }
            @keyframes agentKeycapBounce {
              0% { transform: translate(-50%, 6px) scale(0.85); opacity: 0; }
              25% { transform: translate(-50%, -3px) scale(1.08); opacity: 1; }
              50% { transform: translate(-50%, 0) scale(1); opacity: 1; }
              85% { transform: translate(-50%, 0) scale(1); opacity: 1; }
              100% { transform: translate(-50%, -4px) scale(0.9); opacity: 0; }
            }
            @keyframes agentPerimeterFlash {
              0% { opacity: 0; }
              25% { opacity: 1; }
              100% { opacity: 0; }
            }
            @keyframes agentCheckBloom {
              0% { transform: scale(0.3); opacity: 0; }
              40% { transform: scale(1.3); opacity: 1; }
              70% { transform: scale(1); opacity: 1; }
              100% { transform: scale(1.4); opacity: 0; }
            }
            @keyframes agentDragPulse {
              0% { stroke-dashoffset: 0; }
              100% { stroke-dashoffset: -20; }
            }
          `;
          document.head.appendChild(styleTag);
        }

        // Virtual Cursor Element
        let cursor = document.getElementById("__agent_virtual_cursor");
        let label = document.getElementById("__agent_cursor_label");
        let overlay = document.getElementById("__agent_action_overlay");

        if (!cursor) {
          cursor = document.createElement("div");
          cursor.id = "__agent_virtual_cursor";
          cursor.style.cssText = `
            position: fixed;
            width: 24px;
            height: 24px;
            z-index: 2147483647;
            pointer-events: none;
            transition: left 0.18s cubic-bezier(0.16, 1, 0.3, 1), top 0.18s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease;
            transform: translate(-3px, -3px);
            opacity: 0;
            filter: drop-shadow(0 0 8px rgba(0, 229, 255, 0.75));
          `;
          cursor.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 3L19 10.5L11.5 13.5L8.5 21L4 3Z" fill="#00e5ff" stroke="#070a12" stroke-width="2" stroke-linejoin="round"/>
              <circle cx="5.5" cy="5.5" r="1.5" fill="#ffffff"/>
            </svg>
            <div id="__agent_cursor_label" style="
              position: absolute;
              left: 22px;
              top: 16px;
              background: rgba(15, 23, 42, 0.94);
              color: #f8fafc;
              border: 1px solid rgba(0, 229, 255, 0.6);
              border-radius: 8px;
              padding: 4px 10px;
              font-size: 11px;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
              font-weight: 600;
              white-space: nowrap;
              box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6), 0 0 10px rgba(0, 229, 255, 0.3);
              pointer-events: none;
              opacity: 0;
              transform: translateY(2px);
              transition: opacity 0.2s ease, transform 0.2s ease;
              display: flex;
              align-items: center;
              gap: 6px;
            "></div>
          `;
          document.body.appendChild(cursor);
          label = document.getElementById("__agent_cursor_label");
        }

        // Position cursor
        if (data.x !== undefined && data.y !== undefined) {
          cursor.style.left = `${data.x}px`;
          cursor.style.top = `${data.y}px`;
          cursor.style.opacity = "1";
        }

        // Action Tooltip Pill
        if (data.label && label) {
          label.innerHTML = `<span style="font-size: 13px;">🤖</span> ${data.label}`;
          label.style.opacity = "1";
          label.style.transform = "translateY(0)";

          clearTimeout(window.__agentLabelTimeout);
          window.__agentLabelTimeout = setTimeout(() => {
            if (label) {
              label.style.opacity = "0";
              label.style.transform = "translateY(2px)";
            }
          }, 2400);
        }

        // 2. Click Shockwave Ripple & Cursor Bounce
        if (data.type === "click" && data.x !== undefined && data.y !== undefined) {
          const ripple = document.createElement("div");
          ripple.style.cssText = `
            position: fixed;
            left: ${data.x - 20}px;
            top: ${data.y - 20}px;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            border: 2px solid #00e5ff;
            background: rgba(0, 229, 255, 0.35);
            pointer-events: none;
            z-index: 2147483646;
            transform: scale(0.2);
            opacity: 1;
            transition: transform 0.45s cubic-bezier(0.1, 0.8, 0.2, 1), opacity 0.45s ease-out;
          `;
          document.body.appendChild(ripple);
          requestAnimationFrame(() => {
            ripple.style.transform = "scale(2.8)";
            ripple.style.opacity = "0";
          });
          setTimeout(() => ripple.remove(), 500);

          // Click bounce animation
          cursor.style.transform = "translate(-3px, -3px) scale(0.85)";
          setTimeout(() => {
            cursor.style.transform = "translate(-3px, -3px) scale(1)";
          }, 150);
        }

        // 3. Cinematic Scroll Velocity Strip & Cursor Tilt Animation
        if (data.type === "scroll") {
          const dir = data.direction || "down";
          const isDown = dir === "down" || dir === "bottom";

          // Cursor Wheel Tilt simulation
          if (cursor) {
            cursor.style.opacity = "1";
            cursor.style.transform = isDown
              ? "translate(-3px, -3px) rotate(16deg) scale(0.95)"
              : "translate(-3px, -3px) rotate(-16deg) scale(0.95)";
            setTimeout(() => {
              if (cursor) cursor.style.transform = "translate(-3px, -3px) rotate(0deg) scale(1)";
            }, 350);
          }

          // Calculate scroll progress percentage
          const curY = data.scrollY !== undefined ? data.scrollY : window.scrollY;
          const maxScroll = Math.max(1, (document.documentElement.scrollHeight || document.body.scrollHeight) - window.innerHeight);
          const scrollPct = Math.min(100, Math.max(0, Math.round((curY / maxScroll) * 100)));

          // Scroll HUD capsule on right viewport margin
          let scrollStrip = document.getElementById("__agent_scroll_strip");
          if (!scrollStrip) {
            scrollStrip = document.createElement("div");
            scrollStrip.id = "__agent_scroll_strip";
            scrollStrip.style.cssText = `
              position: fixed;
              right: 24px;
              top: 50%;
              transform: translateY(-50%);
              z-index: 2147483647;
              pointer-events: none;
              background: rgba(15, 23, 42, 0.94);
              color: #f8fafc;
              border: 1px solid rgba(0, 229, 255, 0.7);
              border-radius: 12px;
              padding: 12px 14px;
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 16px rgba(0, 229, 255, 0.35);
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
              font-size: 11px;
              font-weight: 600;
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 8px;
              opacity: 0;
              transition: opacity 0.25s ease, transform 0.25s ease;
            `;
            document.body.appendChild(scrollStrip);
          }

          const arrowAnimation = isDown ? "agentChevronDown 0.6s infinite ease-in-out" : "agentChevronUp 0.6s infinite ease-in-out";
          const arrowSymbol = isDown ? "↓" : "↑";

          scrollStrip.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 2px; color: #00e5ff; font-size: 14px;">
              <span style="animation: ${arrowAnimation};">${arrowSymbol}</span>
              <span style="animation: ${arrowAnimation}; animation-delay: 0.15s;">${arrowSymbol}</span>
            </div>
            <div style="width: 4px; height: 44px; background: rgba(255,255,255,0.12); border-radius: 2px; position: relative; overflow: hidden;">
              <div style="position: absolute; width: 100%; top: 0; height: ${scrollPct}%; background: #00e5ff; box-shadow: 0 0 6px #00e5ff;"></div>
            </div>
            <div style="font-size: 10px; color: #38bdf8; font-weight: 700; white-space: nowrap;">
              ${scrollPct}%
            </div>
            <div style="font-size: 11px; color: #cbd5e1; font-weight: 500; white-space: nowrap; margin-top: 2px;">
              ${data.label || `Scroll ${dir}`}
            </div>
          `;

          scrollStrip.style.opacity = "1";
          scrollStrip.style.transform = "translateY(-50%) scale(1)";

          clearTimeout(window.__agentScrollTimeout);
          window.__agentScrollTimeout = setTimeout(() => {
            if (scrollStrip) {
              scrollStrip.style.opacity = "0";
              scrollStrip.style.transform = "translateY(-50%) scale(0.95)";
            }
          }, 1500);
        }

        // 4. Keyboard Keycap HUD Animation
        if (data.type === "key" && data.key) {
          const keycap = document.createElement("div");
          keycap.style.cssText = `
            position: fixed;
            left: ${data.x !== undefined ? data.x : window.innerWidth / 2}px;
            top: ${data.y !== undefined ? data.y - 45 : window.innerHeight / 2}px;
            z-index: 2147483647;
            pointer-events: none;
            background: linear-gradient(180deg, #1e293b, #0f172a);
            color: #00e5ff;
            border: 1px solid rgba(0, 229, 255, 0.8);
            border-bottom: 3px solid #00e5ff;
            border-radius: 8px;
            padding: 6px 14px;
            font-size: 13px;
            font-family: -apple-system, BlinkMacSystemFont, 'SF Mono', Consolas, monospace;
            font-weight: 700;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7), 0 0 16px rgba(0, 229, 255, 0.5);
            animation: agentKeycapBounce 0.85s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          `;
          const keyLabels = {
            Enter: "↵ Enter",
            Tab: "⇥ Tab",
            Escape: "⎋ Esc",
            Backspace: "⌫ Backspace",
            ArrowDown: "↓ Down",
            ArrowUp: "↑ Up",
            ArrowLeft: "← Left",
            ArrowRight: "→ Right",
            Space: "␣ Space",
          };
          keycap.innerHTML = `⌨️ ${keyLabels[data.key] || data.key}`;
          document.body.appendChild(keycap);
          setTimeout(() => keycap.remove(), 900);
        }

        // 5. Navigation Neon Laser Streamer
        if (data.type === "navigate") {
          let navBeam = document.getElementById("__agent_nav_beam");
          if (!navBeam) {
            navBeam = document.createElement("div");
            navBeam.id = "__agent_nav_beam";
            navBeam.style.cssText = `
              position: fixed;
              top: 0;
              left: 0;
              height: 3px;
              width: 0%;
              z-index: 2147483647;
              pointer-events: none;
              background: linear-gradient(90deg, #00e5ff, #38bdf8, #818cf8);
              box-shadow: 0 0 14px #00e5ff, 0 0 6px #38bdf8;
              animation: agentNavProgress 0.85s ease-out forwards;
            `;
            document.body.appendChild(navBeam);
            setTimeout(() => navBeam.remove(), 900);
          }
        }

        // 6. Tab Focus Perimeter Flash
        if (data.type === "tab_focus") {
          const flash = document.createElement("div");
          flash.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 2147483646;
            pointer-events: none;
            box-shadow: inset 0 0 40px rgba(0, 229, 255, 0.5), inset 0 0 12px #00e5ff;
            animation: agentPerimeterFlash 0.6s ease-out forwards;
          `;
          document.body.appendChild(flash);
          setTimeout(() => flash.remove(), 650);
        }

        // 7. Checkbox & Radio Bloom
        if (data.type === "check" && data.x !== undefined && data.y !== undefined) {
          const checkBloom = document.createElement("div");
          checkBloom.style.cssText = `
            position: fixed;
            left: ${data.x - 16}px;
            top: ${data.y - 16}px;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: rgba(16, 185, 129, 0.35);
            border: 2px solid #10b981;
            color: #10b981;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            font-weight: bold;
            z-index: 2147483647;
            pointer-events: none;
            box-shadow: 0 0 14px rgba(16, 185, 129, 0.6);
            animation: agentCheckBloom 0.6s ease-out forwards;
          `;
          checkBloom.innerHTML = data.checked ? "✓" : "✕";
          document.body.appendChild(checkBloom);
          setTimeout(() => checkBloom.remove(), 650);
        }

        // 8. Target Element Highlight Ring & Typing Pulse
        if (data.rect) {
          if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = "__agent_action_overlay";
            overlay.style.cssText = `
              position: fixed;
              z-index: 2147483645;
              pointer-events: none;
              border: 2px solid #00e5ff;
              background: rgba(0, 229, 255, 0.14);
              border-radius: 6px;
              box-shadow: 0 0 16px rgba(0, 229, 255, 0.8), inset 0 0 8px rgba(0, 229, 255, 0.4);
              transition: all 0.15s ease-out;
            `;
            document.body.appendChild(overlay);
          }
          overlay.style.left = `${data.rect.x - 4}px`;
          overlay.style.top = `${data.rect.y - 4}px`;
          overlay.style.width = `${data.rect.width + 8}px`;
          overlay.style.height = `${data.rect.height + 8}px`;
          overlay.style.opacity = "1";

          if (data.type === "type") {
            overlay.style.animation = "agentPulseGlow 1.2s infinite ease-in-out";
          } else {
            overlay.style.animation = "none";
          }

          clearTimeout(window.__agentOverlayTimeout);
          window.__agentOverlayTimeout = setTimeout(() => {
            if (overlay) overlay.style.opacity = "0";
          }, 1800);
        }

        // 9. Animated Laser Drag Path
        if (data.type === "drag" && data.from && data.to) {
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.style.cssText = `
            position: fixed;
            inset: 0;
            width: 100vw;
            height: 100vh;
            z-index: 2147483646;
            pointer-events: none;
          `;
          svg.innerHTML = `
            <line x1="${data.from.x}" y1="${data.from.y}" x2="${data.to.x}" y2="${data.to.y}"
              stroke="#00e5ff" stroke-width="2.5" stroke-dasharray="6 4" style="animation: agentDragPulse 0.5s linear infinite; filter: drop-shadow(0 0 8px #00e5ff);" />
            <circle cx="${data.to.x}" cy="${data.to.y}" r="6" fill="#00e5ff" style="filter: drop-shadow(0 0 10px #00e5ff);" />
          `;
          document.body.appendChild(svg);
          setTimeout(() => svg.remove(), 700);

          cursor.style.left = `${data.from.x}px`;
          cursor.style.top = `${data.from.y}px`;
          cursor.style.opacity = "1";
          setTimeout(() => {
            cursor.style.left = `${data.to.x}px`;
            cursor.style.top = `${data.to.y}px`;
          }, 80);
        }

        // Auto-fade cursor when idle for 5 seconds
        clearTimeout(window.__agentCursorFadeTimeout);
        window.__agentCursorFadeTimeout = setTimeout(() => {
          if (cursor) cursor.style.opacity = "0";
        }, 5000);
      },
    });
  } catch {}
}


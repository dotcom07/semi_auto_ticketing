import puppeteer from 'puppeteer';
import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';

// 전역 변수로 설정 저장 (재시도 시 사용)
let currentConfig = null;
let uiPage = null;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
// ============================================================
// 0. 크롬 자동 실행 함수
// ============================================================
async function launchChrome() {
    console.log('🚀 시스템 감지 중...');
    const platform = os.platform(); 
    let chromePath = '';
    let userDataDir = path.join(process.cwd(), 'ChromeDebug');

    if (platform === 'win32') {
        chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    } else if (platform === 'darwin') {
        chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    } else {
        console.log('❌ 지원하지 않는 OS입니다.');
        return;
    }

    const args = [
        '--remote-debugging-port=9222',
        `--user-data-dir=${userDataDir}`,
        '--disable-popup-blocking',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1280,1024'
    ];

    const chromeProcess = spawn(chromePath, args, { detached: true, stdio: 'ignore' });
    chromeProcess.unref();
    console.log('✅ 크롬이 실행되었습니다. (0.5초 대기...)');
    await new Promise(resolve => setTimeout(resolve, 500));
}

// ============================================================
// 로그 함수
// ============================================================
async function logToUI(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const cleanMsg = message.replace(/%c/g, ''); 
    if (type === 'error') console.error(`[${timestamp}] ❌ ${cleanMsg}`);
    else if (type === 'success') console.log(`[${timestamp}] ✅ ${cleanMsg}`);
    else console.log(`[${timestamp}] ℹ️ ${cleanMsg}`);

    if (uiPage && !uiPage.isClosed()) {
        try {
            await uiPage.evaluate((msg, type, time) => {
                if (window.addLog) window.addLog(msg, type, time);
            }, cleanMsg, type, timestamp);
        } catch (e) { }
    }
}

async function notifyUIFinished() {
    if (uiPage && !uiPage.isClosed()) {
        try {
            await uiPage.evaluate(() => {
                if (window.botFinished) window.botFinished();
            });
        } catch (e) {}
    }
}

async function activateRetryMode() {
    if (uiPage && !uiPage.isClosed()) {
        await uiPage.evaluate(() => {
            if (window.showRetryButton) window.showRetryButton();
        });
    }
}

// ============================================================
// GUI 실행
// ============================================================
async function launchGUI() {
    console.log('🖥️ 설정 UI 윈도우 실행');
    const platform = os.platform();
    let execPath = '';
    if (platform === 'win32') execPath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    else if (platform === 'darwin') execPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

    const uiBrowser = await puppeteer.launch({
        headless: false,
        executablePath: execPath,
        args: ['--window-size=500,850', '--app=data:text/html,'] 
    });

    const pages = await uiBrowser.pages();
    uiPage = pages[0];
    await uiPage.setViewport({ width: 500, height: 850 });

    // Node -> UI 브릿지 함수
    await uiPage.exposeFunction('checkLoginStatus', async () => {
        let browser = null;
        try {
            browser = await puppeteer.connect({ 
                browserURL: 'http://127.0.0.1:9222', 
                defaultViewport: null,
                timeout: 3000
            });
            const pages = await browser.pages();
            const targetPage = pages.find(p => p.url().includes('ticket.melon.com'));
            
            if (!targetPage || targetPage.isClosed()) {
                if(browser) browser.disconnect();
                return { loggedIn: false, msg: "멜론 페이지 대기..." };
            }

            const loginInfo = await targetPage.evaluate(() => {
                try {
                    const nameArea = document.querySelector('#name_area');
                    return {
                        isLoggedIn: nameArea && nameArea.innerText.includes('반갑습니다'),
                        text: nameArea ? nameArea.innerText : ""
                    };
                } catch (e) { return null; }
            });
            browser.disconnect();
            
            if (!loginInfo) return { loggedIn: false, msg: "로딩 중..." };
            return { loggedIn: loginInfo.isLoggedIn, msg: loginInfo.text };
        } catch (e) {
            if (browser) try { browser.disconnect(); } catch {}
            return { loggedIn: false, msg: "연결 대기..." };
        }
    });

    await uiPage.exposeFunction('startNodeLogic', (data) => {
        currentConfig = data; 
        runBotLogic(data);    
    });

    await uiPage.exposeFunction('retryNodeLogic', () => {
        if (currentConfig) {
            logToUI('🔄 재시도 요청', 'warn');
            runBotLogic(currentConfig);
        }
    });

    // GUI HTML
    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>🍈 멜론 티켓팅 봇</title>
        <meta charset="utf-8">
        <style>
            body { font-family: sans-serif; padding: 20px; background-color: #f0f2f5; color: #333; }
            h2 { text-align: center; color: #00cd3c; margin: 10px 0 20px 0; }
            .group { background: white; padding: 15px; border-radius: 12px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); margin-bottom: 15px; }
            label { display: block; margin-bottom: 5px; font-weight: bold; font-size: 14px; }
            input, select { width: 100%; padding: 10px; margin-bottom: 10px; border: 1px solid #ddd; border-radius: 8px; box-sizing: border-box; }
            button { width: 100%; padding: 15px; border: none; border-radius: 8px; font-size: 18px; font-weight: bold; cursor: pointer; transition: 0.3s; margin-bottom: 10px; }
            #startBtn { background-color: #ccc; color: #666; cursor: not-allowed; } 
            #startBtn.active { background-color: #00cd3c; color: white; cursor: pointer; } 
            #startBtn.active:hover { background-color: #00b033; }
            #retryBtn { background-color: #ff4757; color: white; display: none; }
            .login-status { text-align: center; font-size: 12px; margin-bottom: 10px; color: #666; height: 20px; }
            .status-ok { color: #00cd3c; font-weight: bold; }
            #log-container { background-color: #1e1e1e; color: #00ff00; padding: 15px; border-radius: 12px; height: 300px; overflow-y: auto; font-family: 'Consolas', monospace; font-size: 12px; }
            .log-entry { margin-bottom: 5px; border-bottom: 1px solid #333; padding-bottom: 2px; }
        </style>
    </head>
    <body>
        <h2>🍈 Ticket Bot Controller</h2>
        <div class="group">
            <div id="loginStatusMsg" class="login-status">연결 확인 중...</div>
            <label>📅 목표 날짜</label>
            <div style="display:flex; gap:5px;">
                <input type="number" id="year" value="2026" placeholder="년">
                <input type="number" id="month" value="2" placeholder="월">
                <input type="number" id="day" value="21" placeholder="일">
            </div>
            <label>🤖 AI 모델</label>
            <select id="provider">
                <option value="anthropic" selected>Anthropic (Claude 3.5)</option>
                <option value="openai">OpenAI (GPT-4o)</option>
                <option value="gemini">Google (Gemini)</option>
            </select>
            <button id="startBtn" disabled>🔒 로그인 필요</button>
            <button id="retryBtn">🔄 재시도</button>
        </div>
        <label>📜 진행 로그</label>
        <div id="log-container"></div>
    </body>
    </html>
    `;

    await uiPage.goto(`data:text/html;base64,${Buffer.from(htmlContent).toString('base64')}`);

    // Client Script
    const clientScript = `
        window.addLog = function(msg, type, time) {
            const container = document.getElementById('log-container');
            const div = document.createElement('div');
            div.className = 'log-entry';
            div.style.color = type === 'error' ? '#ff4444' : (type === 'warn' ? '#ffbb00' : '#fff');
            div.innerHTML = '<span style="color:#888">[' + time + ']</span> ' + msg;
            container.appendChild(div);
            container.scrollTop = container.scrollHeight;
        };

        window.showRetryButton = function() {
            document.getElementById('retryBtn').style.display = 'block';
            document.getElementById('startBtn').style.display = 'none';
        };

        window.botFinished = function() {
            isRunning = false; 
            isChecking = false;
        };

        window.resetUI = function() {
            document.getElementById('retryBtn').style.display = 'none';
            document.getElementById('startBtn').style.display = 'block';
            document.getElementById('startBtn').disabled = true;
            document.getElementById('startBtn').innerText = '가동 중...';
            document.getElementById('startBtn').classList.remove('active');
        };

        let isRunning = false;
        let isChecking = false;

        setInterval(async () => {
            if (isRunning || isChecking) return;
            isChecking = true;
            try {
                if (typeof window.checkLoginStatus !== 'function') return;

                const result = await window.checkLoginStatus();
                const btn = document.getElementById('startBtn');
                const statusMsg = document.getElementById('loginStatusMsg');

                if (result.loggedIn) {
                    if (btn.disabled) {
                        btn.disabled = false;
                        btn.classList.add('active');
                        btn.innerText = '🚀 봇 가동 시작';
                        statusMsg.innerHTML = '<span class="status-ok">✅ ' + result.msg + '</span>';
                    }
                } else {
                    btn.disabled = true;
                    btn.classList.remove('active');
                    btn.innerText = '🔒 로그인 필요';
                    if(result.msg !== "상태 확인 중...") statusMsg.innerText = '⚠️ 멜론 티켓에 로그인해주세요. ' + result.msg;
                }
            } catch (err) {} finally { isChecking = false; }
        }, 2000);

        document.getElementById('startBtn').onclick = function() {
            const year = document.getElementById('year').value;
            const month = document.getElementById('month').value;
            const day = document.getElementById('day').value;
            const provider = document.getElementById('provider').value;
            if(!year || !month || !day) { alert('날짜 확인!'); return; }
            
            isRunning = true;
            window.resetUI(); 
            window.startNodeLogic({ targetYear: Number(year), targetMonth: Number(month), targetDay: Number(day), OCR_PROVIDER: provider });
        };

        document.getElementById('retryBtn').onclick = function() {
            window.resetUI();
            window.retryNodeLogic();
        };
    `;
    await uiPage.addScriptTag({ content: clientScript });
}


const OCR_PROMPT_PLAIN = `Extract the 6 uppercase English letters from the captcha image.
            Ignore lines and noise. Focus on the shapes.
            Distinguish 'O' vs 'Q' carefully (Q needs a clear tail).
            Output ONLY the 6 letters. No other text.`;

const OCR_PROMPT_JSON = `You are a captcha solving machine.

Task:
Extract exactly 6 uppercase English letters (A–Z) from the image.

Noise handling rules (VERY IMPORTANT):
- Ignore any horizontal, diagonal, or vertical lines that are NOT part of the character itself.
- Overlaid lines, crossing lines, or background noise MUST be ignored completely.

Character distinction rules:
- O vs Q:
- Q ONLY if there is a clear internal tail that is part of the letter shape.
- If a line crosses the circle but is not an internal tail, it is O.

- I vs H:
- I is a single vertical stroke.
- If a horizontal line crosses near an I but does NOT connect two vertical strokes, it is still I.
- H ONLY if there are TWO distinct vertical strokes connected by a horizontal bar.

- E vs F:
- Both have a single vertical stroke.
- F has ONLY two horizontal bars (top and middle).
- E has THREE horizontal bars (top, middle, and bottom).
- The bottom horizontal bar counts ONLY if it is clearly connected to the vertical stroke.
- If a horizontal line appears near the bottom but is not connected, crosses other characters, or looks like noise, it MUST be ignored.
- In that case, classify the letter as F, not E.


- Do NOT infer characters from noise.
- Do NOT treat crossing lines as character strokes unless they clearly belong to the letter shape.

Output rules (ABSOLUTE):
- Output ONLY a valid JSON object.
- Exactly this format: {"captcha":"ABCDEF"}
- Exactly 6 letters.
- Uppercase A–Z only.
- No explanation.
- No reasoning.
- No extra text.
- No markdown.
`;

// 텍스트 정제 함수
function normalizeCaptcha(text) {
    return text.trim().toUpperCase().replace(/[^A-Z]/g, '');
}

// OpenAI (기존 유지)
async function solveCaptchaWithOpenAI(base64Image) {
    const model = new ChatOpenAI({ modelName: "gpt-4o-mini", temperature: 0 });
    const message = new HumanMessage({
        content: [
            { type: "text", text: OCR_PROMPT_PLAIN },
            { type: "image_url", image_url: { url: `data:image/png;base64,${base64Image}` } }
        ]
    });
    const response = await model.invoke([message]);
    return normalizeCaptcha(response.content);
}

// Gemini (기존 유지)
async function solveCaptchaWithGemini(base64Image) {
    if (!process.env.GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY not set");
    const model = new ChatGoogleGenerativeAI({ model: "gemini-2.5-flash", temperature: 0 });
    const message = new HumanMessage({
        content: [
            { type: "text", text: OCR_PROMPT_PLAIN },
            { type: "image_url", image_url: { url: `data:image/png;base64,${base64Image}` } }
        ]
    });
    const response = await model.invoke([message]);
    return normalizeCaptcha(response.content);
}

// [Anthropic - Claude] ✨ 수정됨 ✨
// JSON 포맷을 강제하고 파싱하는 로직 추가
async function solveCaptchaWithAnthropic(base64Image) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
    
    // OCR 성능: Sonnet 3.5 추천 (Haiku는 복잡한 Captcha에서 약할 수 있음)
    const model = new ChatAnthropic({
        model: "claude-sonnet-4-5-20250929", 
        temperature: 0,
    });

    const message = new HumanMessage({
        content: [
            { type: "text", text: OCR_PROMPT_JSON }, // JSON 프롬프트 사용
            { type: "image_url", image_url: { url: `data:image/png;base64,${base64Image}` } }
        ]
    });

    const response = await model.invoke([message]);
    const rawContent = response.content;
    
    console.log(`🔍 [Anthropic Raw]: ${rawContent}`); // 디버깅용 로그

    try {
        // 1. JSON 추출 시도 (Markdown 코드 블록 제거 등)
        const jsonMatch = rawContent.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
            const jsonStr = jsonMatch[0];
            const parsed = JSON.parse(jsonStr);
            if (parsed.captcha) {
                return normalizeCaptcha(parsed.captcha);
            }
            }
            
            // 2. JSON 파싱 실패 시, 기존 방식대로 정규식 추출 시도 (fallback)
            console.log('⚠️ JSON 파싱 실패, 정규식 추출 시도');
            return normalizeCaptcha(rawContent);

        } catch (err) {
            console.error('❌ Anthropic 응답 파싱 에러:', err);
            return normalizeCaptcha(rawContent);
        }
    }

// ============================================================
// 2. 메인 실행부
// ============================================================

async function runBotLogic(config) {
    const { targetYear, targetMonth, targetDay, OCR_PROVIDER } = config;
    let browser;

    try {
        console.log(`\n=== 🚀 봇 시작: ${targetYear}-${targetMonth}-${targetDay} ===`);
        
        browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222',
            defaultViewport: null
        });

        const pages = await browser.pages();
        const targetPage = pages.find(p => p.url().includes('ticket.melon.com'));

        if (!targetPage) {
            await logToUI('❌ 멜론 티켓 페이지 없음', 'error');
            return;
        }

        // -------------------------------------------------------------
        // [핵심] Node.js 무한 루프 (브라우저 안이 아님!)
        // -------------------------------------------------------------
        await logToUI(`페이지 연결됨: ${targetPage.url()}`);
        const targetFullDate = `${targetYear}${String(targetMonth).padStart(2, '0')}${String(targetDay).padStart(2, '0')}`;
        
        while (true) {
            try {
                // [핵심 변경] "날짜를 선택해주세요!" 문구 유무로만 상태 판단
                const status = await targetPage.evaluate(() => {
                    const finalBtn = document.querySelector('#ticketReservation_Btn');
                    
                    // 1. 날짜 선택 여부 판단 (문구 유무가 가장 확실함)
                    // "날짜를 선택해주세요!" 문구가 있으면 -> 날짜 선택 안됨(false)
                    // 문구가 없으면 -> 날짜 선택됨(true)
                    const timeSection = document.querySelector('#section_time');
                    const hasDateWarning = timeSection && timeSection.innerText.includes('날짜를 선택해주세요');
                    const dateSelected = !hasDateWarning;

                    // 2. 시간 선택 여부 (클래스 on 확인)
                    const timeSelected = !!document.querySelector('#list_time li.on');
                    
                    // 3. 예매 가능 여부
                    const isGreen = finalBtn && finalBtn.classList.contains('btColorGreen');

                    return { 
                        dateSelected, 
                        timeSelected, 
                        // 날짜가 선택됐고, 시간도 선택됐고, 버튼이 초록색이어야 클릭 가능
                        canReserve: dateSelected && timeSelected && isGreen
                    };
                });

                // --- 1. 최종 클릭 조건 달성 시 ---
                if (status.canReserve) {
                    await logToUI('✨ 예매 가능! 클릭 준비', 'success');
                    break;
                }

                // --- 2. 날짜 선택 안 된 경우 ---
                if (!status.dateSelected) {
                    await logToUI('📅 날짜 선택 시도...', 'info');
                    
                    const action = await targetPage.evaluate(async (tYear, tMonth, tDate) => {
                        const sleep = ms => new Promise(r => setTimeout(r, ms));
                        const ym = document.querySelector('#year_month');
                        if(!ym) return 'RETRY';
                        
                        const [cy, cm] = ym.innerText.split('.').map(Number);
                        const diff = (tYear - cy) * 12 + (tMonth - cm);

                        // 달력 이동
                        if(diff > 0) { document.querySelector('.btn_calendar_next')?.click(); return 'NEXT'; }
                        if(diff < 0) { document.querySelector('.btn_calendar_prev')?.click(); return 'PREV'; }

                        // 날짜 클릭
                        const btn = document.querySelector(`#calendar_SelectId_${tDate}`) || document.querySelector(`#dateSelect_${tDate}`);
                        if(btn) { 
                            btn.click(); 
                            return 'CLICK'; 
                        }
                        return 'WAIT';
                    }, targetYear, targetMonth, targetFullDate);

                    if(action === 'NEXT' || action === 'PREV') await sleep(500); // 달력 이동 후 대기
                    else if(action === 'CLICK') await sleep(300); // 클릭 후 대기
                    continue;
                }

                // --- 3. 시간 선택 안 된 경우 ---
                if (!status.timeSelected) {
                    await logToUI('회차 선택 시도...', 'info');
                    await targetPage.evaluate(() => {
                        const btn = document.querySelector('#list_time > li > button');
                        if(btn) btn.click();
                    });
                    await sleep(200);
                    continue;
                }

                await sleep(100);

            } catch (e) {
                // 페이지 새로고침 등으로 컨텍스트 사라지면 무시하고 재시도
                await sleep(200);
            }
        }

        // ============================================================
        // STEP 2: 물리 클릭 및 캡차
        // ============================================================
        const finalBtnSelector = '#ticketReservation_Btn.btColorGreen';
        await targetPage.waitForSelector(finalBtnSelector, { visible: true, timeout: 5000 });
        
        const btnElement = await targetPage.$(finalBtnSelector);
        await btnElement.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
        await sleep(200);

        const boundingBox = await btnElement.boundingBox();
        if (boundingBox) {
            const x = boundingBox.x + boundingBox.width / 2;
            const y = boundingBox.y + boundingBox.height / 2;

            console.log(`🖱️ [Node] 이동 -> (${x}, ${y})`);
            await targetPage.mouse.move(x, y);
            await targetPage.mouse.down();
            await new Promise(r => setTimeout(r, 150));
            await targetPage.mouse.up();
            await logToUI('🔥 예매 버튼 물리 클릭 완료!', 'warn');

            
            await logToUI('👀 팝업창(onestop.htm) 열림 대기 중...');


            async function waitForReservationPopup(browser) {
                while (true) {
                    const pages = await browser.pages();
                    const popup = pages.find(p => p.url().includes("popup/onestop.htm"));
                    if (popup) return popup;
                    await new Promise(r => setTimeout(r, 300));
                }
            }

            async function captureCaptchaBase64(popupPage) {
                await popupPage.bringToFront();
                const captchaEl = await popupPage.waitForSelector("#captchaImg", { visible: true, timeout: 10000 });
                return await captchaEl.screenshot({ encoding: "base64" });
            }

            async function isCaptchaError(popupPage) {
                return await popupPage.evaluate(() => {
                    const errorEl = document.querySelector('#errorMessage');
                    if (!errorEl) return false;

                    // 화면에 실제로 보이는지 확인
                    const isVisible = errorEl.offsetParent !== null;
                    const hasText = errorEl.innerText.includes('문자를 정확히');

                    return isVisible && hasText;
                });
            }

            try {
                const popupPage = await waitForReservationPopup(browser);
                await logToUI(`예매 팝업창 발견: ${popupPage.url()}`, 'success');

                const captchaBase64 = await captureCaptchaBase64(popupPage);
                await logToUI("📸 캡차 이미지 캡처 완료", 'info');

                let captchaText = "";

                if (OCR_PROVIDER === 'openai') {
                    await logToUI("🤖 [AI] OpenAI 분석 중...", 'info');
                    captchaText = await solveCaptchaWithOpenAI(captchaBase64);
                } else if (OCR_PROVIDER === 'gemini') {
                    await logToUI("🤖 [AI] Gemini 분석 중...", 'info');
                    captchaText = await solveCaptchaWithGemini(captchaBase64);
                } else if (OCR_PROVIDER === 'anthropic') {
                    await logToUI("🤖 [AI] Claude 분석 중...", 'info');
                    captchaText = await solveCaptchaWithAnthropic(captchaBase64);
                }

                await logToUI(`🤖 분석 결과: [${captchaText}]`, 'warn');

                if (captchaText && captchaText.length === 6) {
                    await popupPage.type('#label-for-captcha', captchaText);
                    await popupPage.click('#btnComplete');
                    await logToUI("입력 및 제출 완료!", 'success');

                    await new Promise(r => setTimeout(r, 100));

                    const hasError = await isCaptchaError(popupPage);

                    if (hasError) {
                        await logToUI("❌ 캡차 오류: 문자를 정확히 입력해 주세요", "error");
                    } else {
                        await logToUI("캡차 통과!", "success");
                        // 다음 단계 진행
                    }
                
                } else {
                    await logToUI(`❌ 글자수 오류 (${captchaText.length}자). AAAAAA 입력 시도.`, 'error');
                    captchaText = "AAAAAA"
                    await popupPage.type('#label-for-captcha', captchaText);
                }

            } catch (e) {
            await logToUI(`❌ 팝업 에러: ${e.message}`, 'error');
            await activateRetryMode();
            }

        } else {
            await logToUI('❌ 버튼 좌표 계산 실패', 'error');
            await activateRetryMode();
        }
    } catch (e) {
            await logToUI(`❌ 실행 중 에러: ${e.message}`, 'error');
            await activateRetryMode();
        }
    }
(async () => {
    await launchChrome();
    await launchGUI();
})();
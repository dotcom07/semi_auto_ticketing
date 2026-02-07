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

// ============================================================
// 0. 크롬 자동 실행 함수 (배치 파일 대체)
// ============================================================
async function launchChrome() {
    console.log('🚀 시스템 감지 중...');
    
    const platform = os.platform(); // 'win32' or 'darwin' (mac)
    let chromePath = '';
    let userDataDir = path.join(process.cwd(), 'ChromeDebug'); // 실행 파일과 같은 위치에 폴더 생성

    if (platform === 'win32') {
        // 윈도우 기본 경로
        chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        // 만약 64비트 폴더에 없다면 32비트 폴더 체크 (필요시 추가)
    } else if (platform === 'darwin') {
        // 맥 기본 경로
        chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    } else {
        console.log('❌ 지원하지 않는 OS입니다.');
        return;
    }

    console.log(`📂 유저 데이터 경로: ${userDataDir}`);
    console.log(`🌐 크롬 실행 경로: ${chromePath}`);

    // 크롬 실행 인자 (배치 파일 내용과 동일)
    const args = [
        '--remote-debugging-port=9222',
        `--user-data-dir=${userDataDir}`,
        '--disable-popup-blocking',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1280,1024' // (선택) 창 크기 지정
        // 'ticket.melon.com' // (선택) 시작하자마자 멜론 띄우기
    ];

    // 프로세스 실행 (detached: true로 독립 실행)
    const chromeProcess = spawn(chromePath, args, {
        detached: true,
        stdio: 'ignore' 
    });

    chromeProcess.unref(); // 봇이 꺼져도 크롬은 켜져있게 하려면 사용

    console.log('✅ 크롬이 실행되었습니다. (2초 대기...)');
    
    // 크롬이 완전히 켜질 때까지 3초 정도 기다려 줍니다.
    await new Promise(resolve => setTimeout(resolve, 2000));
}

// ============================================================
// [핵심] 로그를 UI와 터미널 양쪽에 출력하는 함수
// ============================================================
async function logToUI(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const cleanMsg = message.replace(/%c/g, ''); 
    
    if (type === 'error') console.error(`[${timestamp}] ❌ ${cleanMsg}`);
    else if (type === 'success') console.log(`[${timestamp}] ✅ ${cleanMsg}`);
    else console.log(`[${timestamp}] ℹ️ ${cleanMsg}`);

    if (uiPage && !uiPage.isClosed()) {
        try {
            // 여기는 단순한 데이터 전달이므로 에러가 나지 않음
            await uiPage.evaluate((msg, type, time) => {
                if (window.addLog) window.addLog(msg, type, time);
            }, cleanMsg, type, timestamp);
        } catch (e) { }
    }
}

// UI에 에러 상태 알림 (재시도 버튼 활성화)
async function activateRetryMode() {
    if (uiPage && !uiPage.isClosed()) {
        await uiPage.evaluate(() => {
            if (window.showRetryButton) window.showRetryButton();
        });
    }
}

// ============================================================
// 1. GUI 설정 윈도우 실행 함수 (스크립트 주입 방식 - 연결 확실함)
// ============================================================
async function launchGUI() {
    console.log('🖥️ 설정 UI 윈도우를 띄웁니다...');
    
    // (중략: 기존 execPath 설정 및 uiBrowser 실행 로직)
    const platform = os.platform();
    let execPath = '';
    if (platform === 'win32') {
        execPath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    } else if (platform === 'darwin') {
        execPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    }

    const uiBrowser = await puppeteer.launch({
        headless: false,
        executablePath: execPath,
        args: ['--window-size=500,850', '--app=data:text/html,'] 
    });

    const pages = await uiBrowser.pages();
    uiPage = pages[0];
    await uiPage.setViewport({ width: 500, height: 850 });

    // --- [추가] 브라우저 로그인 상태 체크 함수 ---
    await uiPage.exposeFunction('checkLoginStatus', async () => {
        try {
            // 실행 중인 디버그 크롬에 연결
            const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222',
                defaultViewport: null
            });
            const pages = await browser.pages();
            // 멜론 티켓 페이지 찾기
            const targetPage = pages.find(p => p.url().includes('ticket.melon.com'));
            
            if (!targetPage) {
                browser.disconnect();
                return { loggedIn: false, msg: "멜론 페이지를 열어주세요" };
            }

            // 로그인 여부 확인 (#name_area에 '반갑습니다' 텍스트 존재 여부)
            const loginInfo = await targetPage.evaluate(() => {
                const nameArea = document.querySelector('#name_area');
                if (nameArea && nameArea.innerText.includes('반갑습니다')) {
                    return { isLoggedIn: true, text: nameArea.innerText };
                }
                return { isLoggedIn: false, text: "" };
            });

            browser.disconnect(); // 연결 해제 (메인 로직과 충돌 방지)
            return { loggedIn: loginInfo.isLoggedIn, msg: loginInfo.text };
        } catch (e) {
            return { loggedIn: false, msg: "크롬 연결 대기 중..." };
        }
    });

    await uiPage.exposeFunction('startNodeLogic', (data) => {
        currentConfig = data; // 설정 저장
        runBotLogic(data);    // 로직 시작
    });

    await uiPage.exposeFunction('retryNodeLogic', () => {
        if (currentConfig) {
            logToUI('🔄 재시도 요청됨! 봇을 다시 시작합니다...', 'warn');
            runBotLogic(currentConfig);
        } else {
            logToUI('❌ 저장된 설정이 없습니다. 처음부터 다시 시작해주세요.', 'error');
        }
    });

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
            
            /* 버튼 스타일 수정 */
            button { width: 100%; padding: 15px; border: none; border-radius: 8px; font-size: 18px; font-weight: bold; cursor: pointer; transition: 0.3s; margin-bottom: 10px; }
            
            #startBtn { background-color: #ccc; color: #666; cursor: not-allowed; } /* 기본 비활성 스타일 */
            #startBtn.active { background-color: #00cd3c; color: white; cursor: pointer; } /* 활성 스타일 */
            #startBtn.active:hover { background-color: #00b033; }
            
            #retryBtn { background-color: #ff4757; color: white; display: none; }
            #retryBtn:hover { background-color: #ff6b81; }
            
            .login-status { text-align: center; font-size: 12px; margin-bottom: 10px; color: #666; }
            .status-ok { color: #00cd3c; font-weight: bold; }

            #log-container {
                background-color: #1e1e1e; color: #00ff00; padding: 15px; border-radius: 12px;
                height: 300px; overflow-y: auto; font-family: 'Consolas', monospace; font-size: 12px;
                box-shadow: inset 0 0 10px rgba(0,0,0,0.5);
            }
            .log-entry { margin-bottom: 5px; border-bottom: 1px solid #333; padding-bottom: 2px; }
            .log-time { color: #888; margin-right: 5px; }
            .log-success { color: #00ff00; font-weight: bold; }
            .log-error { color: #ff4444; font-weight: bold; }
            .log-warn { color: #ffbb00; }
        </style>
    </head>
    <body>
        <h2>🍈 Ticket Bot Controller</h2>
        
        <div class="group">
            <div id="loginStatusMsg" class="login-status">로그인 상태 확인 중...</div>

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
            <button id="retryBtn">🔄 오류 발생! 재시도 하기</button>
        </div>

        <label>📜 진행 로그</label>
        <div id="log-container">
            <div class="log-entry"><span class="log-time">System</span> 대기 중...</div>
        </div>
    </body>
    </html>
    `;

    const base64HTML = Buffer.from(htmlContent).toString('base64');
    await uiPage.goto(`data:text/html;base64,${base64HTML}`);

    const clientScript = `
        // 로그 추가
        window.addLog = function(msg, type, time) {
            const container = document.getElementById('log-container');
            const div = document.createElement('div');
            div.className = 'log-entry';
            let typeClass = 'log-info';
            if(type === 'success') typeClass = 'log-success';
            else if(type === 'error') typeClass = 'log-error';
            else if(type === 'warn') typeClass = 'log-warn';
            div.innerHTML = '<span class="log-time">[' + time + ']</span> <span class="' + typeClass + '">' + msg + '</span>';
            container.appendChild(div);
            container.scrollTop = container.scrollHeight;
        };

        // 재시도 버튼 보이기
        window.showRetryButton = function() {
            document.getElementById('retryBtn').style.display = 'block';
            document.getElementById('startBtn').style.display = 'none';
        };

        // UI 초기화
        window.resetUI = function() {
            document.getElementById('retryBtn').style.display = 'none';
            document.getElementById('startBtn').style.display = 'block';
            document.getElementById('startBtn').disabled = true;
            document.getElementById('startBtn').innerText = '가동 중...';
            document.getElementById('startBtn').classList.remove('active');
        };

        // --- [추가] 로그인 감시자 (1.5초마다 실행) ---
        let isRunning = false;
        setInterval(async () => {
            if (isRunning) return; // 봇 가동 중엔 체크 안 함

            const result = await window.checkLoginStatus();
            const btn = document.getElementById('startBtn');
            const statusMsg = document.getElementById('loginStatusMsg');

            if (result.loggedIn) {
                // 로그인 됨 -> 버튼 활성화
                if (btn.disabled) {
                    btn.disabled = false;
                    btn.classList.add('active');
                    btn.innerText = '🚀 봇 가동 시작';
                    statusMsg.innerHTML = '<span class="status-ok">✅ ' + result.msg + '</span>';
                }
            } else {
                // 로그인 안 됨 -> 버튼 비활성화
                btn.disabled = true;
                btn.classList.remove('active');
                btn.innerText = '🔒 로그인 필요';
                statusMsg.innerText = '⚠️ 멜론 티켓에 로그인해주세요.';
            }
        }, 1500);

        // 시작 버튼 핸들러
        document.getElementById('startBtn').onclick = function() {
            const year = document.getElementById('year').value;
            const month = document.getElementById('month').value;
            const day = document.getElementById('day').value;
            const provider = document.getElementById('provider').value;

            if(!year || !month || !day) {
                alert('날짜를 확인해주세요.');
                return;
            }

            isRunning = true; // 감시 중단
            window.resetUI(); 

            window.startNodeLogic({ 
                targetYear: Number(year), 
                targetMonth: Number(month), 
                targetDay: Number(day), 
                OCR_PROVIDER: provider 
            });
        };

        document.getElementById('retryBtn').onclick = function() {
            window.resetUI();
            window.retryNodeLogic();
        };
    `;

    await uiPage.addScriptTag({ content: clientScript });
}
// ============================================================
// 2. 메인 실행부
// ============================================================

async function runBotLogic(config) {

    // await launchChrome();
    // // [UI 실행] 설정값을 받아옵니다.
    // const config = await launchGUI();

    // 받아온 설정값 변수 할당
    const { targetYear, targetMonth, targetDay, OCR_PROVIDER } = config;


    let browser;
    try {

        console.log('\n==========================================');
        console.log(`✅ 설정 완료!`);
        console.log(`📅 날짜: ${config.targetYear}년 ${config.targetMonth}월 ${config.targetDay}일`);
        console.log(`🤖 모델: ${config.OCR_PROVIDER}`);
        console.log('==========================================\n');


        console.log('🔄 Chrome 브라우저(포트 9222)에 연결 시도 중...');
    

        browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222',
            defaultViewport: null // 기존 창 크기 사용
        });
    } catch (e) {
        await logToUI('❌ Chrome 연결 실패! 디버그 모드로 실행되었는지 확인하세요.', 'error');
        await activateRetryMode();
        return;
    }

    await logToUI('✅ Chrome 연결 성공!', 'success');

    const pages = await browser.pages();
    const targetPage = pages.find(p => p.url().includes('ticket.melon.com'));

    if (!targetPage) {
        await logToUI('❌ 멜론 티켓 페이지를 찾을 수 없습니다.', 'error');
        browser.disconnect();
        await activateRetryMode();
        return;
    }

    // [선택사항] 뷰포트 크기 강제 설정 (화면이 작아 버튼이 안 보이는 경우 대비)
    // await targetPage.setViewport({ width: 1920, height: 1080 });

    await logToUI(`타겟 페이지 발견: ${targetPage.url()}`);

    // 알럿 창 자동 닫기 (이게 뜨면 봇이 멈출 수 있으므로 필수)
    targetPage.on('dialog', async dialog => {
        try { await dialog.accept(); } catch (e) {}
    });

    // 상세 로그 출력
    targetPage.on('console', msg => {
            const text = msg.text().replace(/%c/g, '').replace(/\[.*?\]/g, '').trim();
            if (text.includes('SUCCESS')) logToUI(text, 'success');
            else if (text.includes('ERROR')) logToUI(text, 'error');
            else if (text.includes('ACTION')) logToUI(text, 'warn');
            else logToUI(text, 'info');
        });

    // ============================================================
    // STEP 1: 브라우저 내부 로직 주입
    // ============================================================
    await targetPage.evaluate(async (tYear, tMonth, tDay) => {
        const targetFullDate = `${tYear}${String(tMonth).padStart(2, '0')}${String(tDay).padStart(2, '0')}`;
        console.log(`%c[INFO] 🚀 봇 로직 시작 (목표: ${targetFullDate})`, 'color: cyan');

        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        
        // 안전한 클릭 함수
        const simulateJsClick = (element, name) => {
            if (!element) return false;
            // console.log(`%c[CLICK] 🖱️ ${name}`, 'color: magenta'); // 너무 시끄러우면 주석 처리
            element.click(); 
            return true;
        };

        // 달력 넘기기 로직
        const processCalendar = async () => {
            const ymElement = document.querySelector('#year_month');
            // 달력 연/월 텍스트가 아직 없으면(로딩 중이면) 재시도
            if (!ymElement || !ymElement.innerText) {
                console.log('[RETRY] 달력 연/월 정보 로딩 중...');
                return false;
            }

            const [currentYear, currentMonth] = ymElement.innerText.split('.').map(Number);
            
            // 파싱 실패 시 재시도
            if (!currentYear || !currentMonth) {
                console.log('[RETRY] 달력 날짜 파싱 실패');
                return false;
            }

            let monthDiff = (tYear - currentYear) * 12 + (tMonth - currentMonth);

            if (monthDiff > 0) {
                const nextBtn = document.querySelector('#box_calendar > div > a.btn_calendar_next');
                if (nextBtn) {
                    simulateJsClick(nextBtn, '▶ 다음 달');
                    console.log(`[INFO] 다음 달로 이동 (남은 개월 수: ${monthDiff})`);
                    await sleep(300);
                }
                return false; // 이동 중이므로 아직 선택 불가
            } else if (monthDiff < 0) {
                const prevBtn = document.querySelector('#box_calendar > div > a.btn_calendar_prev');
                if(prevBtn) {
                    simulateJsClick(prevBtn, '◀ 이전 달');
                    console.log(`[INFO] 이전 달로 이동 (남은 개월 수: ${monthDiff})`);
                    await sleep(300);
                }
                return false;
            }
            return true; // 목표 달 도착
        };

        // 날짜 선택 로직 (핵심 수정 부분)
        const trySelectDate = async () => {
            const listContainer = document.querySelector('#box_list_date');
            const calendarContainer = document.querySelector('#box_calendar');

            // [수정] 컴포넌트가 화면에 보이는지 확인
            const isListVisible = listContainer && listContainer.offsetParent !== null;
            const isCalendarVisible = calendarContainer && calendarContainer.offsetParent !== null;

            // [수정] 날짜 컴포넌트가 아예 없으면 false 반환 -> 루프 재시도
            if (!isListVisible && !isCalendarVisible) {
                console.log('[RETRY] 날짜 선택 컴포넌트(리스트/캘린더)가 아직 안 보임'); 
                return false; 
            }

            // 리스트형 처리
            if (isListVisible) {
                // 리스트 모드인데 목표 날짜가 없으면 캘린더 버튼을 눌러본다 (전환 시도)
                const listBtn = document.querySelector(`#dateSelect_${targetFullDate}`);
                if (listBtn) {
                    const clicked = simulateJsClick(listBtn, `📅 리스트 날짜(${tDay}일)`);
                    if(clicked) console.log(`[ACTION] 리스트에서 ${tDay}일 선택`);
                    return clicked;
                } else {
                    console.log('%c[INFO] 리스트에 날짜 없음 -> 캘린더 모드로 전환 시도', 'color: yellow');
                    const calBtn = document.querySelector('button.type_calendar');
                    if(calBtn) {
                        simulateJsClick(calBtn, '📅 캘린더 버튼');
                        await sleep(400);
                    }
                    return false;
                }
            } 
            
            // 캘린더형 처리
            if (isCalendarVisible) {
                const isTargetMonth = await processCalendar();
                if (!isTargetMonth) return false;

                const calendarId = `calendar_SelectId_${targetFullDate}`;
                const dateBtn = document.querySelector(`#${calendarId}`);
                
                if (dateBtn && !dateBtn.disabled && !dateBtn.classList.contains('disabled')) {
                    if (dateBtn.parentElement.classList.contains('on') || dateBtn.classList.contains('on')) {
                        // 이미 선택됨
                        return true; 
                    }
                    const clicked = simulateJsClick(dateBtn, `🎯 캘린더 날짜(${tDay}일)`);
                    if(clicked) console.log(`[ACTION] 캘린더에서 ${tDay}일 선택`);
                    return clicked;
                } else {
                    console.log(`[RETRY] 날짜 버튼(${tDay}일) 비활성화 상태`);
                    return false;
                }
            }

            return false;
        };

        // 시간 선택 로직
        const trySelectTime = async () => {
            const timeList = document.querySelector('#list_time');
            if (!timeList) {
                console.log('[RETRY] 회차(시간) 리스트 로딩 중...');
                return false;
            }
            
            const timeBtn = timeList.querySelector('li:first-child button');
            if (timeBtn) {
                const parentLi = timeBtn.closest('li');
                if (parentLi && parentLi.classList.contains('on')) {
                    return true;
                }
                const clicked = simulateJsClick(timeBtn, '🕘 회차 선택');
                if(clicked) console.log('[ACTION] 첫 번째 회차 선택');
                return clicked;
            }
            console.log('[RETRY] 회차 버튼을 찾을 수 없음');
            return false;
        };

        // 메인 루프 (무한 반복)
        const mainLoop = async () => {
            const initialBtn = document.querySelector('#ticketReservation_Btn');
            if (initialBtn && !document.querySelector('.date_choice')) {
                console.log('[INFO] 초기 예매하기 버튼 클릭');
                simulateJsClick(initialBtn, '초기 예매하기');
                await sleep(500);
            }

            console.log('%c[INFO] 🔄 감시 루프 가동', 'color: cyan');

            while (true) {
                // 1. 날짜 선택 시도
                const dateDone = await trySelectDate();
                if (dateDone) await sleep(200);

                // 2. 시간 선택 시도 (날짜가 성공했을 때만)
                let timeDone = false;
                if (dateDone) {
                    timeDone = await trySelectTime();
                    if (timeDone) await sleep(300);
                }

                // 3. 버튼 상태 확인
                const finalBtn = document.querySelector('#ticketReservation_Btn');
                const isGreen = finalBtn && finalBtn.classList.contains('btColorGreen');
                
                // 상세 상태 로그 (디버깅용)
                if (!dateDone) console.log('[STATUS] 날짜 선택 대기 중...');
                else if (!timeDone) console.log('[STATUS] 회차 선택 대기 중...');
                else if (!isGreen) console.log('[STATUS] 최종 버튼 활성화 대기 중...');

                if (dateDone && timeDone && isGreen) {
                    console.log('%c[SUCCESS] ✨ 조건 충족! 물리 클릭 준비.', 'color: green');
                    break;
                }
                await sleep(300); // 0.3초 대기 후 재시도
            }
        };
        
        await mainLoop();

    }, targetYear, targetMonth, targetDay);


    // ============================================================
    // STEP 2: Puppeteer 물리 클릭 (스크롤 자동 이동 포함)
    // ============================================================
    await logToUI('👀 최종 클릭 대기 중...');
    const finalBtnSelector = '#ticketReservation_Btn.btColorGreen';
    
    try {
        await targetPage.waitForSelector(finalBtnSelector, { visible: true, timeout: 0 });

        console.log('✨ [Node] 목표 포착! 스크롤 이동 및 클릭 시퀀스 시작');
        
        const btnElement = await targetPage.$(finalBtnSelector);

        // [핵심] 버튼이 화면에 보이도록 스크롤 이동 (중앙 정렬)
        await btnElement.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
        await new Promise(r => setTimeout(r, 200));

        // 좌표 다시 계산
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
            // --------------------------------------------------------------------------------
            // 📝 [프롬프트 전략 수정] JSON 포맷 강제
            // --------------------------------------------------------------------------------
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
                await logToUI(`✨ 예매 팝업창 발견: ${popupPage.url()}`, 'success');

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
                    await logToUI("✅ 입력 및 제출 완료!", 'success');

                    await new Promise(r => setTimeout(r, 100));

                    const hasError = await isCaptchaError(popupPage);

                    if (hasError) {
                        await logToUI("❌ 캡차 오류: 문자를 정확히 입력해 주세요", "error");
                    } else {
                        await logToUI("✅ 캡차 통과!", "success");
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
    console.log('✅ 봇 동작 완료.');
}

(async () => {
    await launchChrome();
    await launchGUI();
    // launchGUI 내부에서 버튼 클릭 시 runBotLogic()이 호출됨
})();
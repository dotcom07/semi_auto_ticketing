import puppeteer from 'puppeteer';
import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";

(async () => {

    // 사용할 AI 모델 선택 ('openai' | 'gemini' | 'anthropic')
    const OCR_PROVIDER = 'anthropic';
    // ============================================================
    // [설정 영역] 목표 날짜 설정
    // ============================================================
    const targetYear = 2026;
    const targetMonth = 2; // 2월
    const targetDay = 21;  // 21일
    // ============================================================

    console.log('🔄 Chrome 브라우저(포트 9222)에 연결 시도 중...');

    let browser;
    try {
        browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222',
            defaultViewport: null // 기존 창 크기 사용
        });
    } catch (e) {
        console.error('❌ Chrome 연결 실패. 터미널에서 크롬이 디버그 모드로 실행 중인지 확인하세요.');
        return;
    }

    console.log('✅ Chrome 연결 성공!');

    const pages = await browser.pages();
    const targetPage = pages.find(p => p.url().includes('ticket.melon.com'));

    if (!targetPage) {
        console.error('❌ 멜론 티켓 페이지를 찾을 수 없습니다.');
        browser.disconnect();
        return;
    }

    // [선택사항] 뷰포트 크기 강제 설정 (화면이 작아 버튼이 안 보이는 경우 대비)
    // await targetPage.setViewport({ width: 1920, height: 1080 });

    console.log(`🎯 타겟 페이지 발견: ${targetPage.url()}`);

    // 알럿 창 자동 닫기 (이게 뜨면 봇이 멈출 수 있으므로 필수)
    targetPage.on('dialog', async dialog => {
        try { await dialog.accept(); } catch (e) {}
    });

    // 상세 로그 출력
    targetPage.on('console', msg => {
        const text = msg.text().replace(/%c/g, '').replace(/\[.*?\]/g, '').trim();
        if (text.includes('INFO')) console.log(`[INFO] ${text}`);
        else if (text.includes('SUCCESS')) console.log(`\x1b[32m[SUCCESS] ${text}\x1b[0m`);
        else if (text.includes('RETRY')) console.log(`\x1b[33m[RETRY] ${text}\x1b[0m`);
        else if (text.includes('CLICK')) console.log(`\x1b[35m[ACTION] ${text}\x1b[0m`);
        else if (text.includes('ERROR')) console.log(`\x1b[31m[ERROR] ${text}\x1b[0m`);
        else console.log(`[BROWSER] ${text}`); // 기타 로그도 출력
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
    console.log('👀 [Node] 최종 클릭 대기 중...');
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
            console.log('🔥 [Node] 클릭 완료!');

            
            console.log('👀 [Node] 팝업창(onestop.htm) 열림 대기 중...');
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

            try {
                const popupPage = await waitForReservationPopup(browser);
                console.log(`✨ [Popup] 예매 팝업창 발견: ${popupPage.url()}`);

                const captchaBase64 = await captureCaptchaBase64(popupPage);
                console.log("📸 [Popup] 캡차 캡처 완료");

                let captchaText = "";

                if (OCR_PROVIDER === 'openai') {
                    console.log("🤖 [AI] OpenAI OCR 요청");
                    captchaText = await solveCaptchaWithOpenAI(captchaBase64);
                } else if (OCR_PROVIDER === 'gemini') {
                    console.log("🤖 [AI] Gemini OCR 요청");
                    captchaText = await solveCaptchaWithGemini(captchaBase64);
                } else if (OCR_PROVIDER === 'anthropic') {
                    console.log("🤖 [AI] Anthropic(Claude) OCR 요청");
                    captchaText = await solveCaptchaWithAnthropic(captchaBase64);
                }

                console.log(`🤖 [AI] 최종 추출 결과: ${captchaText}`);

                if (captchaText && captchaText.length === 6) {
                    await popupPage.type('#label-for-captcha', captchaText);
                    console.log('[Popup] 캡차 텍스트 입력 완료');
                    await popupPage.click('#btnComplete');
                    console.log('[Popup] "입력완료" 버튼 클릭!');
                } else {
                    console.error(`❌ [AI] 추출 실패 (글자수 불일치): [${captchaText}]`);
                    captchaText = "AAAAAA"
                    await popupPage.type('#label-for-captcha', captchaText);
                }

            } catch (e) {
            console.error('❌ 팝업 처리 중 에러:', e);
            }

        } else {
            console.error('❌ 버튼 좌표 계산 실패 (화면 밖 가능성)');
        }
    } catch (e) {
        console.error('❌ 클릭 중 에러:', e);
    }
    console.log('✅ 봇 동작 완료.');
})();
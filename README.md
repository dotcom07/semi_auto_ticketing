# 🎫 Melon Ticket Auto Bot (Semi-Auto)

멜론 티켓 예매를 도와주는 반자동 봇입니다.  
Node.js와 Puppeteer를 사용하여 브라우저를 제어하며, 날짜/시간 선택 및 예매하기 버튼 클릭을 자동화합니다.

> **주의:** 이 프로그램은 학습 및 개인적인 용도로만 사용해야 하며, 악용 시 발생하는 불이익에 대한 책임은 사용자에게 있습니다.

## 📌 기능

* **자동 날짜 선택:** 리스트형/캘린더형 UI를 자동 감지하여 목표 날짜를 선택합니다.
* **자동 회차 선택:** 첫 번째 회차를 자동으로 선택합니다.
* **예매하기 클릭:** 버튼이 활성화되면(녹색) 즉시 클릭합니다.
* **무한 재시도:** 버튼이 비활성화 상태일 경우, 새로고침 없이 계속 시도합니다.
* **알럿 자동 닫기:** "날짜를 선택해주세요" 등의 팝업을 자동으로 닫습니다.

## 🛠️ 설치 방법 (Installation)

이 프로젝트를 실행하려면 **Node.js**가 설치되어 있어야 합니다.

1.  **리포지토리 클론 (또는 다운로드)**
    ```bash
    git clone [https://github.com/YOUR_GITHUB_USERNAME/semi_auto_ticketing.git](https://github.com/YOUR_GITHUB_USERNAME/semi_auto_ticketing.git)
    cd semi_auto_ticketing
    ```

2.  **의존성 패키지 설치**
    ```bash
    npm install
    ```
    * `puppeteer` 패키지가 설치됩니다.

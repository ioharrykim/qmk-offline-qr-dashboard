# 발주서 생성기 Apps Script 연동 가이드

## 개요
`generatePurchaseOrderSheet()`에서 체크된 발주 항목을 대시보드로 전송하면,
대시보드가 `마트명 -> 마트코드`, `품목 -> 소재(ad_creative)`로 정규화해
Airbridge 링크와 QR 배치를 자동 생성합니다.

생성된 배치는 대시보드 접속 시 상단 제안 카드/팝업으로 표시됩니다.

## 대시보드 API
- URL: `https://qmk-offline-qr-dashboard.vercel.app/api/order-automation/intake`
- Method: `POST`
- 인증: `Authorization: Bearer {ORDER_AUTOMATION_SECRET}`

## 요청 본문 예시
```json
{
  "source": "apps-script",
  "source_sheet": "요청 현황판",
  "meta": {
    "action": "generatePurchaseOrderSheet"
  },
  "rows": [
    {
      "mart_name": "나이스마트 연경점",
      "item_type": "X배너",
      "count": 2,
      "requester": "홍길동",
      "filename": "260312_naiseumart_yeongyeong_xbanner_1",
      "design_type": "신규",
      "spec": "600x1800"
    }
  ]
}
```

## Apps Script 추가 예시
아래 헬퍼를 `발주서.gs`에 추가한 뒤, `generatePurchaseOrderSheet()` 내부에서 `selectedItems`가 준비된 시점에 호출합니다.

```javascript
function sendOrderQrBatchToDashboard_(selectedItems) {
  const dashboardUrl = 'https://qmk-offline-qr-dashboard.vercel.app/api/order-automation/intake';
  const secret = PropertiesService.getScriptProperties().getProperty('ORDER_AUTOMATION_SECRET');

  if (!secret) {
    Logger.log('ORDER_AUTOMATION_SECRET 누락: QR 자동 생성 생략');
    return;
  }

  const payload = {
    source: 'apps-script',
    source_sheet: '요청 현황판',
    meta: {
      action: 'generatePurchaseOrderSheet'
    },
    rows: selectedItems.map(item => ({
      mart_name: item.martName,
      item_type: item.itemType,
      count: item.count,
      requester: item.requester,
      filename: item.filename,
      design_type: item.designType,
      spec: item.spec
    }))
  };

  const response = UrlFetchApp.fetch(dashboardUrl, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    headers: {
      Authorization: 'Bearer ' + secret
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  Logger.log(response.getResponseCode());
  Logger.log(response.getContentText());
}
```

## 호출 위치 권장
`generatePurchaseOrderSheet()` 안에서 `selectedItems`가 모두 만들어진 뒤,
메일 초안/체크박스 해제 전에 아래처럼 호출합니다.

```javascript
try {
  sendOrderQrBatchToDashboard_(selectedItems);
} catch (e) {
  Logger.log('QR 자동 생성 전송 실패: ' + e.toString());
}
```

이 호출은 발주서 생성 본 흐름을 막지 않도록 `try/catch`로 감싸는 것을 권장합니다.

## 현재 매핑 규칙
- `X배너` -> `xbanner`
- `현수막` -> `banner`
- `전단지` -> `flyer`
- `아크릴` -> `acryl`
- `시트지` -> `sheet`
- `와블러` -> `wobbler`
- `리플렛` -> `leaflet`

## 추가 설정
대시보드/Vercel 환경변수에 아래 키가 필요합니다.

- `ORDER_AUTOMATION_SECRET`

Apps Script 쪽에서는 같은 값을 Script Properties에 저장해 사용합니다.

# Router Info Web

LTE 라우터 신호 데이터(RSRP, RSRQ, SINR, RSSI)를 수집하고 웹 대시보드로 시각화하는 시스템.

## 구성

| 구성요소 | 기술 | 포트 | 설명 |
|---------|------|------|------|
| 프론트엔드 | React + Recharts + Vite | 35442 | Nginx 정적 배포 |
| 백엔드 | Python Sanic (async) | 35443 | REST API + 데이터 수집 |
| DB | MariaDB | 3306 | `ROUTER_INFO` 데이터베이스 |
| 프록시 | Nginx | 35442 | `/api/` -> Sanic 프록시 |

## 디렉토리 구조

```
router-info-web/
├── src/
│   ├── main.jsx          # 엔트리포인트
│   ├── App.jsx           # 라우팅 (로그인/대시보드)
│   ├── LoginPage.jsx     # 로그인 페이지
│   ├── Dashboard.jsx     # 메인 대시보드
│   └── index.css         # 글로벌 스타일
├── router_info_server.py # Sanic 백엔드 서버
├── package.json
├── vite.config.js
└── index.html
```

## Ubuntu 서버 경로

| 항목 | 경로 |
|------|------|
| 소스코드 (git) | `/home/rcn01/router-info-web/` |
| 백엔드 서버 파일 | `/home/rcn01/router_info_server.py` |
| 프론트엔드 배포 | `/var/www/router-info/` |
| Nginx 설정 | `/etc/nginx/sites-available/router-info` |
| systemd 서비스 | `/etc/systemd/system/router-info.service` |
| 로그 디렉토리 | `/home/rcn01/router_info/` (날짜별 .log) |

---

## 개발 환경 설정

### Windows (개발)

```bash
# 1) 저장소 클론
git clone <저장소URL> router-info-web
cd router-info-web

# 2) 의존성 설치
npm install

# 3) 개발 서버 실행 (핫 리로드)
npm run dev
# -> http://localhost:35442
```

### Ubuntu (서버)

```bash
# 1) 저장소 클론 (최초 1회)
cd /home/rcn01
git clone <저장소URL> router-info-web

# 2) Node.js 설치 (없는 경우)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs

# 3) Python 의존성 설치
pip install aiofiles aiomysql sanic

# 4) 의존성 설치
cd /home/rcn01/router-info-web
npm install
```

---

## Git 워크플로우

### Windows에서 수정 -> Ubuntu 반영

```bash
# === Windows ===

# 1) 수정 후 커밋
git add -A
git commit -m "변경 내용 설명"
git push origin main

# === Ubuntu ===

# 2) 최신 코드 받기
cd /home/rcn01/router-info-web
git pull origin main

# 3) 배포 (아래 '배포' 섹션 참고)
```

### Ubuntu에서 수정 -> Windows 반영

```bash
# === Ubuntu ===

# 1) 수정 후 커밋
cd /home/rcn01/router-info-web
git add -A
git commit -m "변경 내용 설명"
git push origin main

# === Windows ===

# 2) 최신 코드 받기
cd router-info-web
git pull origin main
```

### 충돌 발생 시

```bash
git pull origin main
# 충돌 파일 수동 편집 후
git add <충돌파일>
git commit -m "merge: 충돌 해결"
git push origin main
```

---

## 배포

### 백엔드만 배포

```bash
cp /home/rcn01/router-info-web/router_info_server.py /home/rcn01/router_info_server.py
sudo systemctl restart router-info
sudo systemctl status router-info
```

### 프론트엔드만 배포

```bash
cd /home/rcn01/router-info-web
npm run build
sudo rm -rf /var/www/router-info/*
sudo cp -r dist/* /var/www/router-info/
```

### 전체 배포 (한 번에)

```bash
cd /home/rcn01/router-info-web
git pull origin main
cp router_info_server.py /home/rcn01/router_info_server.py
sudo systemctl restart router-info
npm run build
sudo rm -rf /var/www/router-info/*
sudo cp -r dist/* /var/www/router-info/
```

---

## 코드 수정 후 재배포

### Windows에서 수정한 경우

```bash
# === Windows ===
git add -A
git commit -m "변경 내용 설명"
git push origin main

# === Ubuntu ===
cd /home/rcn01/router-info-web
git pull origin main

# 백엔드 수정 시
cp router_info_server.py /home/rcn01/router_info_server.py
sudo systemctl restart router-info

# 프론트엔드 수정 시
npm run build
sudo rm -rf /var/www/router-info/*
sudo cp -r dist/* /var/www/router-info/
```

### Ubuntu에서 직접 수정한 경우

```bash
cd /home/rcn01/router-info-web

# 코드 수정 후 커밋
git add -A
git commit -m "변경 내용 설명"
git push origin main

# 백엔드 수정 시
cp router_info_server.py /home/rcn01/router_info_server.py
sudo systemctl restart router-info

# 프론트엔드 수정 시
npm run build
sudo rm -rf /var/www/router-info/*
sudo cp -r dist/* /var/www/router-info/
```

### 배포 후 확인

```bash
# 백엔드 상태
sudo systemctl status router-info

# 백엔드 로그 (최근 20줄)
sudo journalctl -u router-info -n 20 --no-pager

# 헬스체크
curl http://localhost:35443/healthz
```

---

## 서비스 관리

```bash
# 상태 확인
sudo systemctl status router-info

# 재시작
sudo systemctl restart router-info

# 중지
sudo systemctl stop router-info

# 로그 확인 (실시간)
sudo journalctl -u router-info -f

# Nginx 재시작 (설정 변경 시)
sudo nginx -t && sudo systemctl reload nginx
```

---

## API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST/PUT/PATCH | `/*` | 라우터 데이터 수집 (JSON) |
| GET | `/api/msisdns` | 기기 목록 |
| GET | `/api/metrics/daily_avg` | 일별 평균 |
| GET | `/api/metrics/hourly_avg` | 시간별 평균 |
| GET | `/api/metrics/raw` | 원시 시계열 |
| GET | `/api/records` | 상세 레코드 (페이징) |
| GET | `/api/records/csv` | CSV 다운로드 |
| POST | `/api/devices/alias` | 기기 닉네임 설정 |
| DELETE | `/api/devices` | 기기 휴면 처리 |
| POST | `/api/devices/activate` | 휴면 해제 |
| GET | `/healthz` | 헬스체크 |

---

## DB 관리

```bash
# DB 접속
mysql -u rcn -p ROUTER_INFO

# 테이블 구조 확인
DESCRIBE router_info;
DESCRIBE devices;

# 인덱스 확인
SHOW INDEX FROM router_info;

# 데이터 건수 확인
SELECT COUNT(*) FROM router_info;
SELECT COUNT(*) FROM devices;
```

---

## 환경변수

서버(`router_info_server.py`)에서 사용하는 환경변수:

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `LOG_DIR` | `/home/rcn01/router_info` | 로그 저장 디렉토리 |
| `DB_HOST` | `14.50.159.2` | MariaDB 호스트 |
| `DB_PORT` | `3306` | MariaDB 포트 |
| `DB_USER` | `rcn` | DB 사용자 |
| `DB_PASS` | (없음) | DB 비밀번호 |
| `DB_NAME` | `ROUTER_INFO` | 데이터베이스명 |

systemd 서비스 파일에서 환경변수를 설정:

```bash
sudo vi /etc/systemd/system/router-info.service
```

`[Service]` 섹션에 `Environment` 추가:

```ini
[Service]
User=rcn01
Group=rcn01
WorkingDirectory=/home/rcn01
ExecStart=/usr/bin/python3.12 /home/rcn01/router_info_server.py
Restart=always
RestartSec=3
Environment=PYTHONUNBUFFERED=1
Environment=DB_PASS=your_password_here
```

수정 후 반영:

```bash
sudo systemctl daemon-reload
sudo systemctl restart router-info
```

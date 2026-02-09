import os
import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import csv
import io

from sanic import Sanic, response
from sanic.request import Request
from sanic.exceptions import InvalidUsage

try:
    import aiofiles
    import aiomysql
except ImportError:
    raise SystemExit("`pip install aiofiles aiomysql` 를 먼저 실행하세요.")

APP_NAME = "RawBodyDailyLogger"
LOG_DIR = os.environ.get("LOG_DIR", "/home/rcn01/router_info")
KST = ZoneInfo("Asia/Seoul")

DB_HOST = os.environ.get("DB_HOST", "14.50.159.2")
DB_PORT = int(os.environ.get("DB_PORT", "3306"))
DB_USER = os.environ.get("DB_USER", "rcn")
DB_PASS = os.environ.get("DB_PASS", "")
DB_NAME = os.environ.get("DB_NAME", "ROUTER_INFO")

app = Sanic(APP_NAME)


# ====== 공통 헬퍼 ======

async def log_error(tag: str, exc: Exception):
    """에러를 날짜별 로그 파일에 append."""
    ts = datetime.now(tz=KST)
    msg = f"[{ts.strftime('%Y-%m-%d %H:%M:%S')}] {tag}: {repr(exc)}\n"
    try:
        path = os.path.join(app.ctx.log_dir, f"{ts.strftime('%Y%m%d')}.log")
        async with aiofiles.open(path, "ab") as f:
            await f.write(msg.encode())
    except Exception:
        pass


def build_avg_sql(time_expr: str, time_alias: str, has_range: bool):
    """daily_avg / hourly_avg 공통 SQL 생성."""
    if has_range:
        where = "WHERE `msisdn` = %s AND `ts_kst` >= %s AND `ts_kst` < DATE_ADD(%s, INTERVAL 1 DAY)"
    else:
        where = "WHERE `msisdn` = %s AND `ts_kst` >= (CURRENT_DATE - INTERVAL %s DAY)"

    return f"""
    SELECT
      {time_expr} AS {time_alias},
      AVG(CAST(NULLIF(`rsrp`,'')  AS DECIMAL(10,3))) AS rsrp_avg,
      AVG(CAST(NULLIF(`rsrq`,'')  AS DECIMAL(10,3))) AS rsrq_avg,
      AVG(CAST(NULLIF(`sinr`,'')  AS DECIMAL(10,3))) AS sinr_avg,
      AVG(CAST(NULLIF(`rssi`,'')  AS DECIMAL(10,3))) AS router_rssi_avg
    FROM `router_info`
    {where}
    GROUP BY {time_alias}
    ORDER BY {time_alias} ASC
    """


def rows_decimal_to_float(rows):
    """Decimal 타입 값을 float로 변환."""
    keys = ("rsrp_avg", "rsrq_avg", "sinr_avg", "router_rssi_avg")
    for r in rows:
        for k in keys:
            v = r.get(k)
            if v is not None:
                r[k] = float(v)


# ====== lifecycle ======

@app.exception(Exception)
async def handle_ex(request, exc):
    await log_error("UNHANDLED", exc)
    return response.json({"error": "internal_error", "detail": repr(exc)}, status=500)


@app.listener("before_server_start")
async def before_start(app, _):
    os.makedirs(LOG_DIR, exist_ok=True)
    app.ctx.log_dir = LOG_DIR

    app.ctx.pool = await aiomysql.create_pool(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASS,
        db=DB_NAME,
        autocommit=True,
        minsize=1,
        maxsize=10,
        charset="utf8mb4",
    )


@app.listener("after_server_stop")
async def after_stop(app, _):
    pool = getattr(app.ctx, "pool", None)
    if pool:
        pool.close()
        await pool.wait_closed()


# ====== 데이터 수집 ======

async def append_raw(body: bytes, log_dir: str, ts_kst: datetime):
    """요청 바디 앞에 KST 타임스탬프 붙여서 파일에 append."""
    date_str = ts_kst.strftime("%Y%m%d")
    ts_str = ts_kst.strftime("%Y-%m-%d %H:%M:%S")
    path = os.path.join(log_dir, f"{date_str}.log")
    async with aiofiles.open(path, "ab") as f:
        line = f"[{ts_str}] ".encode() + (body or b"")
        if not line.endswith(b"\n"):
            line += b"\n"
        await f.write(line)


async def insert_db(request: Request, ts_kst: datetime, body: bytes):
    """JSON이면 각 필드 매핑하여 router_info에 INSERT."""
    pool = app.ctx.pool
    client_ip = request.remote_addr or None
    ts_str = ts_kst.strftime("%Y-%m-%d %H:%M:%S")

    row = {
        "ts_kst": ts_str,
        "datetime_str": None, "msisdn": None, "system": None, "plmn": None,
        "band": None, "earfcn_dl": None, "earfcn_ul": None, "bandwidth": None,
        "cell_id": None, "pci": None, "drx": None, "rsrp": None, "rsrq": None,
        "rssi": None, "tac": None, "sinr": None, "rrc_st": None, "emc_st": None,
        "scell_band": None, "scell_bw": None, "scell_status": None,
        "latitude": None, "longitude": None, "ip_v4": None,
        "client_ip": client_ip, "raw_json": None,
    }

    try:
        payload = json.loads(body.decode("utf-8"))
        row["datetime_str"] = payload.get("DATETIME")
        row["msisdn"]       = payload.get("MSISDN")
        row["system"]       = payload.get("SYSTEM")
        row["plmn"]         = payload.get("PLMN")
        row["band"]         = payload.get("Band")
        row["earfcn_dl"]    = payload.get("EARFCN_DL")
        row["earfcn_ul"]    = payload.get("EARFCN_UL")
        row["bandwidth"]    = payload.get("Bandwidth")
        row["cell_id"]      = payload.get("Cell_ID")
        row["pci"]          = payload.get("PCI")
        row["drx"]          = payload.get("DRX")
        row["rsrp"]         = payload.get("RSRP")
        row["rsrq"]         = payload.get("RSRQ")
        row["rssi"]         = payload.get("RSSI")
        row["tac"]          = payload.get("TAC")
        row["sinr"]         = payload.get("SINR")
        row["rrc_st"]       = payload.get("RRC_ST")
        row["emc_st"]       = payload.get("EMC_ST")
        row["scell_band"]   = payload.get("SCELL_BAND")
        row["scell_bw"]     = payload.get("SCELL_BW")
        row["scell_status"] = payload.get("SCELL_STATUS")
        row["latitude"]     = payload.get("LATITUDE")
        row["longitude"]    = payload.get("LONGITUDE")
        row["ip_v4"]        = payload.get("IP_v4")
        row["raw_json"]     = json.dumps(payload, ensure_ascii=False)
    except Exception:
        pass

    sql = """
    INSERT INTO `router_info` (
      `ts_kst`, `datetime_str`, `msisdn`, `system`, `plmn`, `band`,
      `earfcn_dl`, `earfcn_ul`, `bandwidth`, `cell_id`, `pci`, `drx`,
      `rsrp`, `rsrq`, `rssi`, `tac`, `sinr`, `rrc_st`, `emc_st`,
      `scell_band`, `scell_bw`, `scell_status`, `latitude`, `longitude`,
      `ip_v4`, `client_ip`, `raw_json`
    ) VALUES (
      %(ts_kst)s, %(datetime_str)s, %(msisdn)s, %(system)s, %(plmn)s, %(band)s,
      %(earfcn_dl)s, %(earfcn_ul)s, %(bandwidth)s, %(cell_id)s, %(pci)s, %(drx)s,
      %(rsrp)s, %(rsrq)s, %(rssi)s, %(tac)s, %(sinr)s, %(rrc_st)s, %(emc_st)s,
      %(scell_band)s, %(scell_bw)s, %(scell_status)s, %(latitude)s, %(longitude)s,
      %(ip_v4)s, %(client_ip)s, %(raw_json)s
    )
    """
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            if row["msisdn"]:
                await cur.execute(
                    """
                    INSERT INTO devices (msisdn, dormant, dormant_at) VALUES (%s, 0, NULL) AS new
                    ON DUPLICATE KEY UPDATE
                    msisdn = new.msisdn,
                    dormant = 0,
                    dormant_at = NULL
                    """,
                    (row["msisdn"],)
                )
            await cur.execute(sql, row)


@app.route("/<path:path>", methods=["POST", "PUT", "PATCH"], name="log_any_path")
@app.route("/", methods=["POST", "PUT", "PATCH"], name="log_any_root")
async def log_any(request: Request, path: str = ""):
    ts_kst = datetime.now(tz=KST)
    body = request.body or b""

    await append_raw(body, app.ctx.log_dir, ts_kst)

    try:
        await insert_db(request, ts_kst, body)
    except Exception as e:
        await log_error("DB_ERROR", e)

    return response.text("ok\n")


# ====== API 엔드포인트 ======

# 1) 기기 리스트
@app.get("/api/msisdns", name="list_msisdns")
async def list_msisdns(req: Request):
    include_dormant = (req.args.get("include_dormant", "0") in ("1", "true", "yes"))

    cutoff_dt = (datetime.now(tz=KST) - timedelta(hours=24)).strftime("%Y-%m-%d %H:%M:%S")

    where_dormant = "" if include_dormant else "WHERE d.dormant = 0"

    sql = f"""
    SELECT
      d.msisdn,
      d.alias,
      d.dormant,
      EXISTS(
        SELECT 1 FROM router_info r
        WHERE r.msisdn = d.msisdn
          AND r.ts_kst >= %s
      ) AS has_recent
    FROM devices d
    {where_dormant}
    ORDER BY
      CASE WHEN d.alias IS NULL OR d.alias = '' THEN 1 ELSE 0 END ASC,
      d.alias ASC,
      d.msisdn ASC
    """

    async with app.ctx.pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(sql, (cutoff_dt,))
            rows = await cur.fetchall()

    devices = [{
        "msisdn": r["msisdn"],
        "alias": r["alias"],
        "dormant": bool(r["dormant"]),
        "has_recent": bool(r["has_recent"]),
    } for r in rows]

    return response.json({"devices": devices})


# 2) 일별 평균
@app.get("/api/metrics/daily_avg", name="daily_avg")
async def daily_avg(req: Request):
    msisdn = req.args.get("msisdn")
    raw_days = (req.args.get("days", "7") or "7").strip()
    days = int(float(raw_days or 7))
    start = req.args.get("start")
    end   = req.args.get("end")

    if not msisdn:
        raise InvalidUsage("msisdn is required")

    has_range = bool(start and end)
    sql = build_avg_sql("DATE(`ts_kst`)", "d", has_range)
    params = (msisdn, start, end) if has_range else (msisdn, days)

    try:
        async with app.ctx.pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(sql, params)
                rows = await cur.fetchall()

        for r in rows:
            if hasattr(r.get("d"), "strftime"):
                r["d"] = r["d"].strftime("%Y-%m-%d")
        rows_decimal_to_float(rows)

        return response.json({"msisdn": msisdn, "days": days, "start": start, "end": end, "data": rows})
    except Exception as e:
        await log_error("DAILY_AVG_ERROR", e)
        return response.json({"error": "query_failed", "detail": repr(e)}, status=500)


# 2-1) 시간별 평균
@app.get("/api/metrics/hourly_avg", name="hourly_avg")
async def hourly_avg(req: Request):
    msisdn = req.args.get("msisdn")
    raw_days = (req.args.get("days", "7") or "7").strip()
    days = int(float(raw_days or 7))
    start = req.args.get("start")
    end   = req.args.get("end")

    if not msisdn:
        raise InvalidUsage("msisdn is required")

    has_range = bool(start and end)
    sql = build_avg_sql(r"DATE_FORMAT(`ts_kst`, '%%Y-%%m-%%d %%H:00:00')", "h", has_range)
    params = (msisdn, start, end) if has_range else (msisdn, days)

    try:
        async with app.ctx.pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(sql, params)
                rows = await cur.fetchall()

        rows_decimal_to_float(rows)

        return response.json({"msisdn": msisdn, "days": days, "start": start, "end": end, "data": rows})
    except Exception as e:
        await log_error("HOURLY_AVG_ERROR", e)
        return response.json({"error": "query_failed", "detail": repr(e)}, status=500)


# 2-2) 원시 시계열
@app.get("/api/metrics/raw", name="metrics_raw")
async def metrics_raw(req: Request):
    msisdn = req.args.get("msisdn")
    days   = int(req.args.get("days", "7"))
    start  = req.args.get("start")
    end    = req.args.get("end")

    if not msisdn:
        raise InvalidUsage("msisdn is required")

    if start and end:
        sql = """
        SELECT
          ts_kst,
          CAST(NULLIF(rsrp,'')  AS DECIMAL(10,3)) AS rsrp,
          CAST(NULLIF(rsrq,'')  AS DECIMAL(10,3)) AS rsrq,
          CAST(NULLIF(sinr,'')  AS DECIMAL(10,3)) AS sinr,
          CAST(NULLIF(rssi,'')  AS DECIMAL(10,3)) AS router_rssi
        FROM router_info
        WHERE msisdn = %s
          AND ts_kst >= %s
          AND ts_kst < DATE_ADD(%s, INTERVAL 1 DAY)
        ORDER BY ts_kst ASC
        """
        params = (msisdn, start, end)
        try:
            range_end_boundary = datetime.strptime(end, "%Y-%m-%d").replace(tzinfo=KST) + timedelta(days=1)
        except Exception:
            range_end_boundary = datetime.now(tz=KST)
    else:
        cutoff = (datetime.now(tz=KST) - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
        sql = """
        SELECT
          ts_kst,
          CAST(NULLIF(rsrp,'')  AS DECIMAL(10,3)) AS rsrp,
          CAST(NULLIF(rsrq,'')  AS DECIMAL(10,3)) AS rsrq,
          CAST(NULLIF(sinr,'')  AS DECIMAL(10,3)) AS sinr,
          CAST(NULLIF(rssi,'')  AS DECIMAL(10,3)) AS router_rssi
        FROM router_info
        WHERE msisdn = %s
          AND ts_kst >= %s
        ORDER BY ts_kst ASC
        """
        params = (msisdn, cutoff)
        range_end_boundary = datetime.now(tz=KST)

    try:
        async with app.ctx.pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(sql, params)
                rows = await cur.fetchall()

        def to_float(v):
            if v is None:
                return None
            try:
                return float(v)
            except Exception:
                return None

        raw_points = []
        for r in rows:
            ts_dt = r["ts_kst"]
            if isinstance(ts_dt, datetime) and ts_dt.tzinfo is None:
                ts_dt = ts_dt.replace(tzinfo=KST)
            raw_points.append({
                "ts": ts_dt,
                "rsrp": to_float(r.get("rsrp")),
                "rsrq": to_float(r.get("rsrq")),
                "sinr": to_float(r.get("sinr")),
                "router_rssi": to_float(r.get("router_rssi")),
                "is_fake": False,
            })

        filled = []
        FIVE_MIN = 300

        prev = None
        for p in raw_points:
            if prev is not None:
                delta_sec = (p["ts"] - prev["ts"]).total_seconds()
                gaps = int(delta_sec // FIVE_MIN) - 1
                if gaps > 0:
                    for i in range(1, gaps + 1):
                        ts_fake = prev["ts"] + timedelta(minutes=5 * i)
                        filled.append({
                            "ts": ts_fake,
                            "rsrp": -125.0,
                            "rsrq": -15.0,
                            "sinr": 5.0,
                            "router_rssi": -100.0,
                            "is_fake": True,
                        })
            filled.append(p)
            prev = p

        if raw_points:
            last = raw_points[-1]
            now_kst = datetime.now(tz=KST)
            tail_to = min(range_end_boundary, now_kst)

            if tail_to > last["ts"]:
                delta_sec = (tail_to - last["ts"]).total_seconds()
                gaps_tail = int(delta_sec // FIVE_MIN) - 1
                if gaps_tail > 0:
                    for i in range(1, gaps_tail + 1):
                        ts_fake = last["ts"] + timedelta(minutes=5 * i)
                        if ts_fake >= tail_to:
                            break
                        filled.append({
                            "ts": ts_fake,
                            "rsrp": -125.0,
                            "rsrq": -15.0,
                            "sinr": 5.0,
                            "router_rssi": -100.0,
                            "is_fake": True,
                        })
        else:
            filled = []

        filled.sort(key=lambda x: x["ts"])

        out = []
        for p in filled:
            out.append({
                "ts": p["ts"].strftime("%Y-%m-%d %H:%M:%S"),
                "rsrp": p["rsrp"],
                "rsrq": p["rsrq"],
                "sinr": p["sinr"],
                "router_rssi": p["router_rssi"],
                "is_fake": p["is_fake"],
            })

        return response.json({
            "msisdn": msisdn, "days": days,
            "start": start, "end": end, "data": out,
        })
    except Exception as e:
        await log_error("METRICS_RAW_ERROR", e)
        return response.json({"error": "query_failed", "detail": repr(e)}, status=500)


# 3) 상세 레코드 (페이징)
@app.get("/api/records", name="records")
async def records(req: Request):
    msisdn = req.args.get("msisdn")
    start  = req.args.get("start")
    end    = req.args.get("end")
    page   = int(req.args.get("page", "1"))
    size   = int(req.args.get("page_size", "200"))
    order = (req.args.get("order") or "desc").lower()
    order_sql = "ASC" if order == "asc" else "DESC"
    if not (msisdn and start and end):
        raise InvalidUsage("msisdn, start, end are required")

    page   = max(1, page)
    size   = max(1, min(size, 1000))
    offset = (page - 1) * size

    sql = f"""
    SELECT
      `id`,`ts_kst`,`datetime_str`,`system`,`plmn`,`band`,`earfcn_dl`,`earfcn_ul`,
      `bandwidth`,`cell_id`,`pci`,`drx`,`rsrp`,`rsrq`,`rssi`,`tac`,`sinr`,`rrc_st`,`emc_st`,
      `scell_band`,`scell_bw`,`scell_status`,`latitude`,`longitude`,`ip_v4`
    FROM `router_info`
    WHERE `msisdn`=%s
      AND `ts_kst` >= %s
      AND `ts_kst` < DATE_ADD(%s, INTERVAL 1 DAY)
    ORDER BY `ts_kst` {order_sql}
    LIMIT {size} OFFSET {offset}
    """

    async with app.ctx.pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(sql, (msisdn, start, end))
            rows = await cur.fetchall()

            for r in rows:
                if isinstance(r.get("ts_kst"), datetime):
                    r["ts_kst"] = r["ts_kst"].strftime("%Y-%m-%d %H:%M:%S")

            await cur.execute("""
                SELECT COUNT(*) AS cnt
                FROM `router_info`
                WHERE `msisdn`=%s
                  AND `ts_kst` >= %s
                  AND `ts_kst` < DATE_ADD(%s, INTERVAL 1 DAY)
            """, (msisdn, start, end))
            total = (await cur.fetchone())["cnt"]

            return response.json({
                "msisdn": msisdn, "start": start, "end": end,
                "page": page, "page_size": size, "total": total, "rows": rows
            })


# 4) CSV 다운로드
@app.get("/api/records/csv", name="records_csv")
async def records_csv(req: Request):
    msisdn = req.args.get("msisdn")
    start  = req.args.get("start")
    end    = req.args.get("end")
    if not (msisdn and start and end):
        raise InvalidUsage("msisdn, start, end are required")

    order = (req.args.get("order") or "desc").lower()
    order_sql = "ASC" if order == "asc" else "DESC"

    sep = (req.args.get("sep") or "comma").lower()
    if sep in ("semicolon", "semi", "sc"):
        delimiter = ";"
        ext = "csv"
    elif sep in ("tab", "tsv"):
        delimiter = "\t"
        ext = "tsv"
    else:
        delimiter = ","
        ext = "csv"

    filename = f"router_{msisdn}_{start}_{end}.{ext}"

    headers_cols = [
        "id","ts_kst","datetime_str","system","plmn","band","earfcn_dl","earfcn_ul",
        "bandwidth","cell_id","pci","drx","rsrp","rsrq","rssi","tac","sinr","rrc_st","emc_st",
        "scell_band","scell_bw","scell_status","latitude","longitude","ip_v4"
    ]

    sql = f"""
    SELECT
      `id`,`ts_kst`,`datetime_str`,`system`,`plmn`,`band`,`earfcn_dl`,`earfcn_ul`,
      `bandwidth`,`cell_id`,`pci`,`drx`,`rsrp`,`rsrq`,`rssi`,`tac`,`sinr`,`rrc_st`,`emc_st`,
      `scell_band`,`scell_bw`,`scell_status`,`latitude`,`longitude`,`ip_v4`
    FROM `router_info`
    WHERE `msisdn`=%s
      AND `ts_kst` >= %s
      AND `ts_kst` < DATE_ADD(%s, INTERVAL 1 DAY)
    ORDER BY `ts_kst` {order_sql}
    """

    sio = io.StringIO(newline="")
    writer = csv.writer(
        sio,
        delimiter=delimiter,
        lineterminator="\r\n",
        quoting=csv.QUOTE_MINIMAL,
        quotechar='"',
        escapechar=None,
    )
    writer.writerow(headers_cols)

    async with app.ctx.pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, (msisdn, start, end))
            while True:
                rows = await cur.fetchmany(2000)
                if not rows:
                    break
                for row in rows:
                    row = list(row)
                    if isinstance(row[1], datetime):
                        row[1] = row[1].strftime("%Y-%m-%d %H:%M:%S")
                    writer.writerow(row)

    content = "\ufeff" + sio.getvalue()
    headers_resp = {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Cache-Control": "no-store",
    }
    return response.raw(content.encode("utf-8"), headers=headers_resp)


# 5) 기기 설정
@app.post("/api/devices/alias", name="set_alias")
async def set_alias(req: Request):
    try:
        data = req.json
    except Exception:
        raise InvalidUsage("invalid json")

    msisdn = (data or {}).get("msisdn")
    alias  = (data or {}).get("alias")
    if not msisdn:
        raise InvalidUsage("msisdn is required")

    if alias is not None:
        alias = alias.strip()
        if alias == "":
            alias = None

    async with app.ctx.pool.acquire() as conn:
        async with conn.cursor() as cur:
            sql = """
            INSERT INTO devices (msisdn, alias) VALUES (%s, %s)
            ON DUPLICATE KEY UPDATE alias = %s
            """
            await cur.execute(sql, (msisdn, alias, alias))

    return response.json({"ok": True, "msisdn": msisdn, "alias": alias})


@app.delete("/api/devices", name="delete_device")
async def delete_device(req: Request):
    msisdn = req.args.get("msisdn")
    cascade = req.args.get("cascade", "0") in ("1", "true", "yes")

    if not msisdn:
        raise InvalidUsage("msisdn is required")

    async with app.ctx.pool.acquire() as conn:
        async with conn.cursor() as cur:
            if cascade:
                await cur.execute("DELETE FROM router_info WHERE msisdn=%s", (msisdn,))

            await cur.execute(
                "UPDATE devices SET dormant=1, dormant_at=NOW() WHERE msisdn=%s",
                (msisdn,)
            )

    return response.json({"ok": True, "msisdn": msisdn, "cascade": cascade, "dormant": True})


@app.post("/api/devices/activate", name="activate_device")
async def activate_device(req: Request):
    data = req.json or {}
    msisdn = data.get("msisdn")
    if not msisdn:
        raise InvalidUsage("msisdn is required")

    async with app.ctx.pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE devices SET dormant=0, dormant_at=NULL WHERE msisdn=%s",
                (msisdn,)
            )

    return response.json({"ok": True, "msisdn": msisdn, "dormant": False})


@app.get("/healthz", name="healthz")
async def health(_):
    return response.json({"status": "ok"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=35443, access_log=False)

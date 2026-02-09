import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

// Nginx가 /api/ 를 sanic(35443)로 프록시하는 구성이라면 빈 문자열 유지
const API = "";

/** 지표 기준/상한(요청 반영: 하한 삭제, 상한만) */
const REF = {
  rsrp: { center: -100, upper: -84 },
  rsrq: { center: -10, upper: -6 },
  sinr: { center: 15, upper: 19 },
  router_rssi: { center: -70, upper: -56 },
};

/** 차트 모드별 설정 */
const CHART_METRICS = [
  { title: "RSSI (dBm)", metric: "router_rssi" },
  { title: "SINR (dB)", metric: "sinr" },
  { title: "RSRQ (dB)", metric: "rsrq" },
  { title: "RSRP (dBm)", metric: "rsrp" },
];

const CHART_MODE_CONFIG = {
  raw:        { suffix: "",     xKey: "ts" },
  hourly_avg: { suffix: "_avg", xKey: "h" },
  daily_avg:  { suffix: "_avg", xKey: "d" },
};

export default function Dashboard({ user, onLogout }) {
  // devices
  const [devices, setDevices] = useState([]);
  const [msisdn, setMsisdn] = useState("");

  // dormant toggle
  const [showDormant, setShowDormant] = useState(false);

  // tabs
  const [tab, setTab] = useState("chart"); // chart | table

  // chart mode
  const [chartMode, setChartMode] = useState("raw"); // hourly_avg | daily_avg | raw
  const [daily, setDaily] = useState([]);
  const [hourly, setHourly] = useState([]);
  const [raw, setRaw] = useState([]);
  const [chartStart, setChartStart] = useState(() => todayOffset(-7));
  const [chartEnd, setChartEnd] = useState(() => todayOffset(0));

  // table mode
  const [start, setStart] = useState(() => todayOffset(-7));
  const [end, setEnd] = useState(() => todayOffset(0));
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 200;

  // ordering
  const [sortOrder, setSortOrder] = useState("desc"); // asc | desc

  // refresh
  const [lastUpdated, setLastUpdated] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshSec, setRefreshSec] = useState(30);

  // RSSI only mode
  const [rssiOnly, setRssiOnly] = useState(false);
  const [allDeviceRssi, setAllDeviceRssi] = useState([]); // [{msisdn, alias, data:[]}]

  // device settings modal
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aliasInput, setAliasInput] = useState("");

  const timerRef = useRef(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth < 900);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ---------- helpers ----------
  const selectedDevice = useMemo(
    () => devices.find((d) => d.msisdn === msisdn) || null,
    [devices, msisdn]
  );

  function sortDevices(list) {
    return [...list].sort((a, b) => {
      const aName = (a.alias || "").trim();
      const bName = (b.alias || "").trim();
      const aKey = aName ? aName.toLowerCase() : a.msisdn;
      const bKey = bName ? bName.toLowerCase() : b.msisdn;
      if (aKey < bKey) return -1;
      if (aKey > bKey) return 1;
      return 0;
    });
  }

  const loadDevices = useCallback(async (selectMsisdn = null) => {
    const url = `${API}/api/msisdns?include_dormant=${showDormant ? 1 : 0}`;
    const r = await fetch(url);
    const d = await r.json();
    const list = sortDevices((d.devices || []).map((x) => ({
      ...x,
      dormant: !!x.dormant,
      has_recent: !!x.has_recent,
    })));

    setDevices(list);

    if (selectMsisdn) {
      setMsisdn(selectMsisdn);
      return list;
    }
    if (!selectMsisdn && list.length) {
      const firstActive = list.find((x) => x.has_recent && !x.dormant);
      setMsisdn(firstActive ? firstActive.msisdn : list[0].msisdn);
    }
    return list;
  }, [showDormant]);

  function stampUpdated() {
    const now = new Date();
    const s = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(now);
    setLastUpdated(s);
  }

  const fetchChart = useCallback(async () => {
    if (!msisdn) return;

    const qs = `msisdn=${encodeURIComponent(msisdn)}&start=${encodeURIComponent(chartStart)}&end=${encodeURIComponent(chartEnd)}`;

    if (chartMode === "hourly_avg") {
      const r = await fetch(`${API}/api/metrics/hourly_avg?${qs}`);
      const d = await r.json();
      setHourly(d.data || []);
      return;
    }

    if (chartMode === "daily_avg") {
      const r = await fetch(`${API}/api/metrics/daily_avg?${qs}`);
      const d = await r.json();
      setDaily(d.data || []);
      return;
    }

    // raw
    const r = await fetch(`${API}/api/metrics/raw?${qs}`);
    const d = await r.json();
    setRaw(d.data || []);
  }, [msisdn, chartMode, chartStart, chartEnd]);

  const fetchTable = useCallback(async () => {
    if (!msisdn) return;
    const url =
      `${API}/api/records?msisdn=${encodeURIComponent(msisdn)}` +
      `&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}` +
      `&page=${page}&page_size=${pageSize}&order=${sortOrder}`;

    const r = await fetch(url);
    const d = await r.json();
    setRows(d.rows || []);
    setTotal(d.total || 0);
  }, [msisdn, start, end, page, sortOrder]);

  const fetchAllDeviceRssi = useCallback(async () => {
    const activeDevices = (showDormant ? devices : devices.filter(d => !d.dormant))
      .filter(d => d.has_recent);
    if (!activeDevices.length) { setAllDeviceRssi([]); return; }

    const endpoint = chartMode === "hourly_avg" ? "hourly_avg"
      : chartMode === "daily_avg" ? "daily_avg" : "raw";

    const results = await Promise.all(
      activeDevices.map(async (dev) => {
        const qs = `msisdn=${encodeURIComponent(dev.msisdn)}&start=${encodeURIComponent(chartStart)}&end=${encodeURIComponent(chartEnd)}`;
        try {
          const r = await fetch(`${API}/api/metrics/${endpoint}?${qs}`);
          const d = await r.json();
          return { msisdn: dev.msisdn, alias: dev.alias || "", data: d.data || [] };
        } catch {
          return { msisdn: dev.msisdn, alias: dev.alias || "", data: [] };
        }
      })
    );
    setAllDeviceRssi(results.filter(r => r.data.length > 0));
  }, [devices, showDormant, chartMode, chartStart, chartEnd]);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      loadDevices(msisdn || null),
      tab === "chart" ? fetchChart() : fetchTable(),
    ]);
    stampUpdated();
  }, [loadDevices, msisdn, tab, fetchChart, fetchTable]);

  const visibleDevices = useMemo(() => {
    return showDormant ? devices : devices.filter(d => !d.dormant);
  }, [devices, showDormant]);

  // ---------- effects ----------
  // 초기 로드 + showDormant 바뀌면 목록 재조회
  useEffect(() => {
    (async () => {
      try {
        await loadDevices(msisdn || null);
      } catch {}
    })();
  }, [loadDevices]);

  useEffect(() => {
    if (!visibleDevices || visibleDevices.length === 0) {
      if (msisdn) setMsisdn("");
      return;
    }

    const exists = visibleDevices.some(d => d.msisdn === msisdn);

    if (!exists) {
      setMsisdn(visibleDevices[0].msisdn);
      setPage(1);
    }
  }, [showDormant, visibleDevices, msisdn]);

  // msisdn 바뀌면 현재 활성 탭 데이터만 로드
  useEffect(() => {
    if (!msisdn) return;
    setAliasInput(selectedDevice?.alias || "");
    (async () => {
      try {
        if (tab === "chart") {
          await fetchChart();
        } else {
          await fetchTable();
        }
        stampUpdated();
      } catch {}
    })();
  }, [msisdn, tab, fetchChart, fetchTable, selectedDevice]);

  // chart params 변경 시
  useEffect(() => {
    if (!msisdn || tab !== "chart") return;
    (async () => {
      try {
        await fetchChart();
        stampUpdated();
      } catch {}
    })();
  }, [fetchChart, msisdn, tab]);

  // rssiOnly 모드: 전체 기기 RSSI fetch
  useEffect(() => {
    if (!rssiOnly || tab !== "chart") return;
    (async () => {
      try {
        await fetchAllDeviceRssi();
        stampUpdated();
      } catch {}
    })();
  }, [rssiOnly, tab, fetchAllDeviceRssi]);

  // table params 변경 시
  useEffect(() => {
    if (!msisdn || tab !== "table") return;
    (async () => {
      try {
        await fetchTable();
        stampUpdated();
      } catch {}
    })();
  }, [fetchTable, msisdn, tab]);

  // auto refresh timer
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;

    if (!autoRefresh) return;

    const ms = Math.max(5, Number(refreshSec || 30)) * 1000;
    timerRef.current = setInterval(() => {
      refreshAll();
    }, ms);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [autoRefresh, refreshSec, refreshAll]);

  // ---------- actions ----------
  async function handleSaveAlias() {
    if (!msisdn) return;
    const alias = (aliasInput || "").trim();

    const r = await fetch(`${API}/api/devices/alias`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msisdn, alias }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      alert(j.detail || "닉네임 저장 실패");
      return;
    }

    await loadDevices(msisdn);
    setSettingsOpen(false);
    stampUpdated();
  }

  async function handleDormantDevice() {
    if (!msisdn) return;
    const ok = window.confirm(`기기 ${msisdn}을(를) 휴면 처리할까요? (데이터는 삭제되지 않습니다)`);
    if (!ok) return;

    const r = await fetch(`${API}/api/devices?msisdn=${encodeURIComponent(msisdn)}`, {
      method: "DELETE",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      alert(j.detail || "휴면 처리 실패");
      return;
    }

    // loadDevices가 반환하는 최신 목록으로 판단
    const freshList = await loadDevices(null);
    const still = freshList.some((d) => d.msisdn === msisdn);
    if (!still) {
      if (freshList.length) setMsisdn(freshList[0].msisdn);
      else setMsisdn("");
    }

    setSettingsOpen(false);
    stampUpdated();
  }

  // ---------- render helpers ----------
  const deviceLabel = (d) => {
    const name = (d.alias || "").trim();
    return name ? `${name} (${d.msisdn})` : d.msisdn;
  };

  // 현재 chart mode에 맞는 데이터/키 결정
  const chartData = chartMode === "raw" ? raw : chartMode === "hourly_avg" ? hourly : daily;
  const modeConfig = CHART_MODE_CONFIG[chartMode];

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <div>
          <div style={styles.title}>Router Info Dashboard</div>
          <div style={styles.subTitle}>
            {user ? <span>{user} 님</span> : null}
            {lastUpdated ? <span style={{ marginLeft: 10, color: "#6b7280" }}>마지막 갱신: {lastUpdated}</span> : null}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={styles.checkboxLabel}>
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            <span style={{ marginLeft: 6 }}>자동 새로고침</span>
          </label>
          <select value={refreshSec} onChange={(e) => setRefreshSec(Number(e.target.value))} style={styles.selectSmall}>
            {[10, 20, 30, 60, 120].map((n) => (
              <option key={n} value={n}>{n}s</option>
            ))}
          </select>
          <div style={{ width: 12 }} />
          <button onClick={() => refreshAll()} style={styles.primaryBtn}>
            새로고침
          </button>

          <button onClick={() => { setAliasInput(selectedDevice?.alias || ""); setSettingsOpen(true); }} style={styles.ghostBtn}>
            기기설정
          </button>

          {onLogout ? (
            <button onClick={onLogout} style={styles.ghostBtn}>
              로그아웃
            </button>
          ) : null}
        </div>
      </div>

      {/* 상단 컨트롤 */}
      <div style={styles.toolbar}>
        <label style={styles.label}>
          기기(msisdn):
          <select
            value={msisdn}
            onChange={(e) => {
              setMsisdn(e.target.value);
              setPage(1);
            }}
            style={styles.select}
          >
            {visibleDevices.map((d) => {
              const style = {
                color: d.dormant ? "#fca5a5" : (!d.has_recent ? "#9ca3af" : "#111827"),
              };
              return (
                <option key={d.msisdn} value={d.msisdn} style={style}>
                  {deviceLabel(d)}{d.dormant ? " [휴면]" : ""}
                </option>
              );
            })}
          </select>
        </label>

        <label style={{ ...styles.checkboxLabel, marginLeft: 6 }}>
          <input
            type="checkbox"
            checked={showDormant}
            onChange={(e) => setShowDormant(e.target.checked)}
          />
          <span style={{ marginLeft: 6 }}>휴면 기기 보기</span>
        </label>

        <div style={{ flex: 1 }} />

        {tab === "chart" ? (
          <label style={{ ...styles.checkboxLabel, marginRight: 4 }}>
            <input
              type="checkbox"
              checked={rssiOnly}
              onChange={(e) => setRssiOnly(e.target.checked)}
            />
            <span style={{ marginLeft: 6 }}>RSSI만 보기</span>
          </label>
        ) : null}

        <button onClick={() => setTab("chart")} style={btn(tab === "chart")}>그래프</button>
        <button onClick={() => setTab("table")} style={btn(tab === "table")}>상세</button>
      </div>

      {/* 본문 */}
      {tab === "chart" ? (
        <div>
          <div style={{...styles.sectionRow,flexDirection: "row-reverse"}}>
            <div style={styles.sectionTitle}>그래프</div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexDirection: "row-reverse" }}>

              <label style={styles.label}>
                표시방식:
                <select value={chartMode} onChange={(e) => setChartMode(e.target.value)} style={styles.selectSmall}>
                  <option value="raw">모든 데이터</option>
                  <option value="hourly_avg">시간별 평균</option>
                  <option value="daily_avg">일별 평균</option>
                </select>
              </label>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={styles.label}>
                  시작일:{" "}
                  <input type="date" value={chartStart} onChange={(e) => setChartStart(e.target.value)} style={styles.date} />
                </div>
                <div style={styles.label}>
                  종료일:{" "}
                  <input type="date" value={chartEnd} onChange={(e) => setChartEnd(e.target.value)} style={styles.date} />
                </div>
              </div>

            </div>
          </div>

          {rssiOnly ? (
            allDeviceRssi.length === 0 ? (
              <div style={styles.empty}>해당 범위에 RSSI 데이터가 없습니다.</div>
            ) : (
              allDeviceRssi.map(({ msisdn: devMsisdn, alias, data }) => {
                const label = alias ? `${alias} (${devMsisdn})` : devMsisdn;
                const dataKey = "router_rssi" + modeConfig.suffix;
                return (
                  <MetricChart
                    key={devMsisdn}
                    title={`RSSI — ${label}`}
                    data={data}
                    dataKey={dataKey}
                    xKey={modeConfig.xKey}
                    metric="router_rssi"
                  />
                );
              })
            )
          ) : chartData.length === 0 ? (
            <div style={styles.empty}>해당 범위에 데이터가 없습니다.</div>
          ) : (
            CHART_METRICS.map(({ title, metric }) => {
              const baseKey = metric === "router_rssi" ? "router_rssi" : metric;
              const dataKey = baseKey + modeConfig.suffix;
              return (
                <MetricChart
                  key={metric}
                  title={title}
                  data={chartData}
                  dataKey={dataKey}
                  xKey={modeConfig.xKey}
                  metric={metric}
                />
              );
            })
          )}
        </div>
      ) : (
        <div>
          <div style={styles.sectionRow}>
            <div style={styles.sectionTitle}>상세</div>

            <div style={styles.tableControls}>
              <div style={styles.label}>
                시작일:{" "}
                <input
                  type="date"
                  value={start}
                  onChange={(e) => { setStart(e.target.value); setPage(1); }}
                  style={styles.date}
                />
              </div>

              <div style={styles.label}>
                종료일:{" "}
                <input
                  type="date"
                  value={end}
                  onChange={(e) => { setEnd(e.target.value); setPage(1); }}
                  style={styles.date}
                />
              </div>

              <button
                onClick={() => setSortOrder((o) => (o === "desc" ? "asc" : "desc"))}
                style={styles.ghostBtn}
                title="정렬 토글"
              >
                정렬: {sortOrder === "desc" ? "최신순" : "오래된순"}
              </button>

              <button
                onClick={() => {
                  if (!msisdn || !start || !end) return;
                  const url =
                    `${API}/api/records/csv?msisdn=${encodeURIComponent(msisdn)}` +
                    `&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}` +
                    `&order=${encodeURIComponent(sortOrder)}`;
                  window.open(url, "_blank");
                }}
                style={styles.primaryBtn}
              >
                CSV 다운로드
              </button>
            </div>
          </div>

          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>{headers.map((h) => <th key={h} style={{ ...styles.th, ...(compact ? styles.thCompact : null) }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const zebra = idx % 2 === 0 ? "#ffffff" : "#f9fafb";
                  return (
                    <tr
                      key={r.id || idx}
                      style={{ background: zebra, transition: "background 0.15s ease" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#eef2ff")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = zebra)}
                    >
                      {headers.map((h) => (
                        <td key={h} style={{ ...styles.td, ...(compact ? styles.tdCompact : null) }}>{fmt(r, h)}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 오른쪽에 떠다니는 페이징 */}
          <div style={styles.floatingPager}>
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} style={styles.pagerBtn}>
              이전
            </button>
            <div style={styles.pagerInfo}>
              {page} / {Math.max(1, Math.ceil(total / pageSize))}
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>총 {total}건</div>
            </div>
            <button
              disabled={page >= Math.ceil(total / pageSize)}
              onClick={() => setPage((p) => p + 1)}
              style={styles.pagerBtn}
            >
              다음
            </button>
          </div>
        </div>
      )}

      {/* --------- Settings Modal --------- */}
      {settingsOpen ? (
        <div style={styles.modalBackdrop} onMouseDown={() => setSettingsOpen(false)}>
          <div style={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>기기 설정</div>
            <div style={{ color: "#6b7280", marginBottom: 10 }}>
              {selectedDevice ? deviceLabel(selectedDevice) : msisdn}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ ...styles.label, display: "block" }}>
                <span style={{ whiteSpace: "nowrap" }}>닉네임(별칭)</span>
                <input
                  value={aliasInput}
                  onChange={(e) => setAliasInput(e.target.value)}
                  placeholder="예: 목덕C1, 신길A3"
                  style={styles.input}
                />
              </label>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setSettingsOpen(false)} style={styles.ghostBtn}>취소</button>
                <button onClick={handleSaveAlias} style={styles.primaryBtn}>저장</button>
              </div>

              <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 12, marginTop: 6 }}>
                <div style={{ color: "#6b7280", fontSize: 13, marginBottom: 8 }}>
                  기기 삭제는 영구 삭제가 아니라 "휴면 처리"로 동작합니다.
                </div>
                <button onClick={handleDormantDevice} style={styles.dangerBtn}>
                  기기 휴면 처리
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** X축 라벨을 파싱하여 Unix timestamp로 변환 (uPlot은 초 단위 timestamp 사용) */
function parseXToEpoch(val, xKey) {
  if (!val) return null;
  if (xKey === "d") {
    // "2025-01-15" -> epoch seconds
    const d = new Date(val + "T00:00:00+09:00");
    return isNaN(d) ? null : d.getTime() / 1000;
  }
  // h: "2025-01-15 14:00:00" 또는 ts: "2025-01-15 14:30:00"
  const d = new Date(val.replace(" ", "T") + "+09:00");
  return isNaN(d) ? null : d.getTime() / 1000;
}

/** 기준선 플러그인: center(초록) + upper(빨강 점선) */
function refLinesPlugin(ref) {
  if (!ref) return {};
  return {
    hooks: {
      draw: [
        (u) => {
          const ctx = u.ctx;
          const yAxis = u.scales.y;
          const left = u.bbox.left;
          const width = u.bbox.width;

          // center 기준선 (초록, 굵게)
          const centerY = u.valToPos(ref.center, "y", true);
          if (centerY >= u.bbox.top && centerY <= u.bbox.top + u.bbox.height) {
            ctx.save();
            ctx.strokeStyle = "#32CD32";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(left, centerY);
            ctx.lineTo(left + width, centerY);
            ctx.stroke();
            ctx.restore();
          }

          // upper 상한선 (빨강, 점선)
          const upperY = u.valToPos(ref.upper, "y", true);
          if (upperY >= u.bbox.top && upperY <= u.bbox.top + u.bbox.height) {
            ctx.save();
            ctx.strokeStyle = "#ef4444";
            ctx.lineWidth = 1;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(left, upperY);
            ctx.lineTo(left + width, upperY);
            ctx.stroke();
            ctx.restore();
          }
        },
      ],
    },
  };
}

/** 마우스 커서 위치에 뜨는 플로팅 툴팁 플러그인 */
function cursorTooltipPlugin() {
  let tooltip;

  function init(u) {
    tooltip = document.createElement("div");
    Object.assign(tooltip.style, {
      position: "absolute",
      display: "none",
      pointerEvents: "none",
      background: "rgba(255,255,255,0.95)",
      border: "1px solid #d1d5db",
      borderRadius: "8px",
      padding: "6px 10px",
      fontSize: "12px",
      fontWeight: "700",
      color: "#111827",
      boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
      zIndex: "100",
      whiteSpace: "nowrap",
      lineHeight: "1.5",
    });
    u.over.appendChild(tooltip);
  }

  function setCursor(u) {
    const idx = u.cursor.idx;
    if (idx == null) {
      tooltip.style.display = "none";
      return;
    }

    const xVal = u.data[0][idx];
    const yVal = u.data[1][idx];

    if (xVal == null || yVal == null) {
      tooltip.style.display = "none";
      return;
    }

    // 시간 포맷
    const d = new Date(xVal * 1000);
    const pad2 = (n) => n.toString().padStart(2, "0");
    const timeStr = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

    // 값 포맷
    const valStr = typeof yVal === "number" ? yVal.toFixed(3) : yVal;
    const label = u.series[1]?.label || "값";

    tooltip.innerHTML = `<div style="color:#6b7280;font-size:11px">${timeStr}</div><div>${label}: <span style="color:#2563eb">${valStr}</span></div>`;
    tooltip.style.display = "block";

    // 위치 계산: 커서 근처, 차트 밖으로 안 벗어나게
    const cx = u.valToPos(xVal, "x");
    const cy = u.valToPos(yVal, "y");
    const overRect = u.over.getBoundingClientRect();
    const ttRect = tooltip.getBoundingClientRect();

    let left = cx + 12;
    let top = cy - ttRect.height - 8;

    // 오른쪽 넘치면 왼쪽으로
    if (left + ttRect.width > overRect.width) {
      left = cx - ttRect.width - 12;
    }
    // 위로 넘치면 아래로
    if (top < 0) {
      top = cy + 12;
    }

    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";
  }

  return {
    hooks: {
      init: [init],
      setCursor: [setCursor],
    },
  };
}

/** 개별 지표 차트 (uPlot Canvas 기반) */
function MetricChart({ title, data, dataKey, xKey = "d", metric }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const ref = REF[metric];

  useEffect(() => {
    if (!containerRef.current || !data || data.length === 0) return;

    // 기존 차트 제거
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    // 데이터 변환: [{ts, router_rssi, ...}] -> [xArr, yArr]
    const xArr = [];
    const yArr = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const x = parseXToEpoch(row[xKey], xKey);
      const y = typeof row[dataKey] === "number" ? row[dataKey] : null;
      if (x !== null) {
        xArr.push(x);
        yArr.push(y);
      }
    }

    if (xArr.length === 0) return;

    // Y축 범위 계산 (기존 로직 유지)
    let yRange;
    if (ref) {
      const vals = yArr.filter((v) => v !== null && Number.isFinite(v));
      if (vals.length) {
        const dataMin = Math.min(...vals);
        const dataMax = Math.max(...vals);
        const delta = Math.max(
          Math.abs(dataMax - ref.center),
          Math.abs(ref.center - dataMin),
          Math.abs(ref.upper - ref.center)
        );
        const pad = Math.max(delta * 0.05, 1);
        yRange = [ref.center - (delta + pad), ref.center + (delta + pad)];
      } else {
        const delta = Math.abs(ref.upper - ref.center);
        yRange = [ref.center - delta, ref.center + delta];
      }
      if (!Number.isFinite(yRange[0]) || !Number.isFinite(yRange[1])) {
        yRange = null;
      }
    }

    const container = containerRef.current;
    const w = container.clientWidth;
    const h = container.clientHeight - 28; // 타이틀 높이 빼기

    // X축 포맷터: 시간별 평균은 MM-DD:HH, 나머지는 MM-DD
    const xValues = xKey === "h"
      ? (u, splits) => splits.map((v) => {
          const d = new Date(v * 1000);
          const mm = (d.getMonth() + 1).toString().padStart(2, "0");
          const dd = d.getDate().toString().padStart(2, "0");
          const hh = d.getHours().toString().padStart(2, "0");
          return `${mm}-${dd}:${hh}`;
        })
      : (u, splits) => splits.map((v) => {
          const d = new Date(v * 1000);
          return `${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
        });

    const opts = {
      width: w,
      height: Math.max(h, 160),
      cursor: {
        drag: { x: false, y: false },
      },
      plugins: [refLinesPlugin(ref), cursorTooltipPlugin()],
      legend: { show: false },
      scales: {
        x: { time: true },
        y: yRange
          ? { range: () => yRange }
          : { auto: true },
      },
      axes: [
        {
          stroke: "#6b7280",
          grid: { stroke: "rgba(209,213,219,0.5)", dash: [4, 4] },
          values: xValues,
          font: "12px system-ui",
          ticks: { show: true },
        },
        {
          stroke: "#6b7280",
          grid: { stroke: "rgba(209,213,219,0.5)", dash: [4, 4] },
          values: (u, splits) => splits.map((v) => Number.isFinite(v) ? Math.round(v) : v),
          font: "12px system-ui",
          size: 50,
        },
      ],
      series: [
        {},
        {
          label: dataKey,
          stroke: "#2563eb",
          width: 1.5,
          points: { show: false },
        },
      ],
    };

    const uplotData = [xArr, yArr];
    const chart = new uPlot(opts, uplotData, container);
    chartRef.current = chart;

    // resize observer
    const ro = new ResizeObserver(() => {
      if (chartRef.current && container) {
        chartRef.current.setSize({
          width: container.clientWidth,
          height: Math.max(container.clientHeight - 28, 160),
        });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [data, dataKey, xKey, metric, ref]);

  return (
    <div style={styles.chartCard}>
      <div style={{ marginBottom: 6, fontWeight: 700, color: "#111827" }}>{title}</div>
      <div ref={containerRef} style={{ width: "100%", height: "calc(100% - 28px)" }} />
    </div>
  );
}

const headers = [
  "ts_kst",
  "datetime_str",
  "system",
  "plmn",
  "band",
  "earfcn_dl",
  "earfcn_ul",
  "bandwidth",
  "cell_id",
  "pci",
  "drx",
  "rsrp",
  "rsrq",
  "rssi",
  "tac",
  "sinr",
  "rrc_st",
  "emc_st",
  "scell_band",
  "scell_bw",
  "scell_status",
  "latitude",
  "longitude",
  "ip_v4",
];

function fmt(row, key) {
  return row?.[key] ?? "";
}
function todayOffset(n) {
  const now = new Date();
  const base = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  base.setDate(base.getDate() + n);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
}

function btn(active) {
  return {
    padding: "9px 14px",
    borderRadius: 10,
    border: active ? "2px solid #2563eb" : "1px solid #d1d5db",
    background: active ? "#2563eb" : "#ffffff",
    color: active ? "#ffffff" : "#111827",
    fontWeight: 700,
    cursor: "pointer",
  };
}

const styles = {
  page: {
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    padding: 18,
    background: "#f8fafc",
    minHeight: "100vh",
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  title: { fontSize: 22, fontWeight: 800, color: "#0f172a" },
  subTitle: { marginTop: 4, fontSize: 13, color: "#374151" },

  toolbar: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    padding: 12,
    borderRadius: 14,
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
    marginBottom: 14,
  },

  label: {
    display: "inline-flex",
    gap: 8,
    alignItems: "center",
    color: "#111827",
    fontSize: 13,
    fontWeight: 700,
  },
  checkboxLabel: {
    display: "inline-flex",
    alignItems: "center",
    color: "#111827",
    fontSize: 13,
    fontWeight: 700,
  },

  select: {
    marginLeft: 6,
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111827",
    fontWeight: 700,
  },
  selectSmall: {
    marginLeft: 6,
    padding: "7px 10px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111827",
    fontWeight: 700,
    fontSize: 13,
  },
  date: {
    padding: "7px 10px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111827",
    fontWeight: 700,
    fontSize: 13,
  },

  primaryBtn: {
    padding: "9px 14px",
    borderRadius: 10,
    border: "1px solid #2563eb",
    background: "#2563eb",
    color: "#fff",
    fontWeight: 800,
    cursor: "pointer",
  },
  ghostBtn: {
    padding: "9px 14px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#111827",
    fontWeight: 800,
    cursor: "pointer",
  },
  dangerBtn: {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #ef4444",
    background: "#fff",
    color: "#ef4444",
    fontWeight: 900,
    cursor: "pointer",
  },

  sectionRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
    padding: "10px 12px",
    borderRadius: 14,
    background: "#ffffff",
    border: "1px solid #e5e7eb",
  },
  sectionTitle: { fontSize: 16, fontWeight: 900, color: "#0f172a" },

  chartCard: {
    height: 260,
    marginBottom: 16,
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 12,
    background: "#ffffff",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  },

  empty: {
    padding: 14,
    color: "#6b7280",
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 14,
  },

  tableWrap: {
    overflow: "auto",
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    background: "#ffffff",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
    maxHeight: "calc(100vh - 260px)",
    WebkitOverflowScrolling: "touch",
  },

  table: {
    borderCollapse: "collapse",
    width: "100%",
    fontSize: 13,
    minWidth: 980,
  },

  th: {
    position: "sticky",
    top: 0,
    background: "#111827",
    color: "#ffffff",
    borderBottom: "1px solid #0f172a",
    padding: "10px 12px",
    textAlign: "left",
    fontWeight: 900,
    fontSize: 13,
    letterSpacing: 0.2,
    zIndex: 2,
    whiteSpace: "nowrap",
  },

  td: {
    padding: "9px 12px",
    borderBottom: "1px solid #e5e7eb",
    color: "#111827",
    fontSize: 13,
    whiteSpace: "nowrap",
  },

  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 50,
  },
  modal: {
    width: "min(520px, 96vw)",
    background: "#ffffff",
    borderRadius: 16,
    border: "1px solid #e5e7eb",
    boxShadow: "0 10px 30px rgba(0,0,0,0.20)",
    padding: 16,
  },
  modalTitle: { fontSize: 16, fontWeight: 900, color: "#0f172a", marginBottom: 8 },
  input: {
    marginTop: 6,
    width: "80%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #d1d5db",
    outline: "none",
    fontWeight: 800,
    color: "#111827",
    background: "#fff",
  },
  floatingPager: {
    position: "sticky",
    right: 12,
    bottom: 12,
    float: "right",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid #e5e7eb",
    background: "rgba(255,255,255,0.92)",
    backdropFilter: "blur(6px)",
    boxShadow: "0 6px 16px rgba(0,0,0,0.10)",
    margin: 12,
    zIndex: 5,
  },

  pagerBtn: {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#111827",
    fontWeight: 800,
    cursor: "pointer",
  },

  pagerInfo: {
    minWidth: 130,
    textAlign: "center",
    fontWeight: 900,
    color: "#111827",
    lineHeight: 1.2,
  },

  thCompact: { padding: "8px 10px", fontSize: 12 },
  tdCompact: { padding: "8px 10px", fontSize: 12 },
  tableControls: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "center",
    justifyContent: "flex-start",
  },
};

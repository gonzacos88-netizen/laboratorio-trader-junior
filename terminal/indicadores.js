// Terminal Cósmico v2 · indicadores y transformaciones PURAS (sin DOM). Se usan en el navegador (window.IND) y en node
// (require) para las pruebas. Entrada: velas [{time, open, high, low, close, volume?}] ordenadas por time.
// Salida: series [{time, value}] alineadas con las velas (sin los primeros puntos que no se pueden calcular).
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m; else raiz.IND = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function sma(velas, n, campo = 'close') {
    const out = []; let s = 0;
    for (let i = 0; i < velas.length; i++) {
      s += velas[i][campo];
      if (i >= n) s -= velas[i - n][campo];
      if (i >= n - 1) out.push({ time: velas[i].time, value: s / n });
    }
    return out;
  }

  function ema(velas, n, campo = 'close') {
    const out = []; const k = 2 / (n + 1); let e = null, s = 0;
    for (let i = 0; i < velas.length; i++) {
      const x = velas[i][campo];
      if (i < n) { s += x; if (i === n - 1) { e = s / n; out.push({ time: velas[i].time, value: e }); } continue; }
      e = x * k + e * (1 - k);
      out.push({ time: velas[i].time, value: e });
    }
    return out;
  }

  function bollinger(velas, n = 20, k = 2) {
    const sup = [], med = [], inf = [];
    for (let i = n - 1; i < velas.length; i++) {
      let s = 0; for (let j = i - n + 1; j <= i; j++) s += velas[j].close;
      const m = s / n; let v = 0;
      for (let j = i - n + 1; j <= i; j++) v += (velas[j].close - m) ** 2;
      const d = Math.sqrt(v / n), t = velas[i].time;
      sup.push({ time: t, value: m + k * d }); med.push({ time: t, value: m }); inf.push({ time: t, value: m - k * d });
    }
    return { sup, med, inf };
  }

  // RSI de Wilder (el mismo que TradingView): la primera media es simple; después, suavizado (n−1)/n.
  function rsi(velas, n = 14) {
    const out = []; let g = 0, p = 0;
    for (let i = 1; i < velas.length; i++) {
      const d = velas[i].close - velas[i - 1].close;
      const sube = Math.max(d, 0), baja = Math.max(-d, 0);
      if (i <= n) { g += sube; p += baja; if (i === n) { g /= n; p /= n; out.push({ time: velas[i].time, value: p === 0 ? 100 : 100 - 100 / (1 + g / p) }); } continue; }
      g = (g * (n - 1) + sube) / n; p = (p * (n - 1) + baja) / n;
      out.push({ time: velas[i].time, value: p === 0 ? 100 : 100 - 100 / (1 + g / p) });
    }
    return out;
  }

  // ATR de Wilder.
  function atr(velas, n = 14) {
    const out = []; let a = null, s = 0;
    for (let i = 1; i < velas.length; i++) {
      const v = velas[i], pc = velas[i - 1].close;
      const tr = Math.max(v.high - v.low, Math.abs(v.high - pc), Math.abs(v.low - pc));
      if (i <= n) { s += tr; if (i === n) { a = s / n; out.push({ time: v.time, value: a }); } continue; }
      a = (a * (n - 1) + tr) / n;
      out.push({ time: v.time, value: a });
    }
    return out;
  }

  function macd(velas, rapida = 12, lenta = 26, senal = 9) {
    const er = ema(velas, rapida), el = ema(velas, lenta);
    const mr = new Map(er.map((x) => [x.time, x.value]));
    const linea = el.map((x) => ({ time: x.time, close: mr.get(x.time) - x.value }));
    const sen = ema(linea, senal);
    const ms = new Map(sen.map((x) => [x.time, x.value]));
    return {
      macd: linea.map((x) => ({ time: x.time, value: x.close })),
      senal: sen,
      hist: linea.filter((x) => ms.has(x.time)).map((x) => ({ time: x.time, value: x.close - ms.get(x.time) })),
    };
  }

  // VWAP de la SESIÓN: se reinicia cuando cambia el día (en la zona `zonaMin`, minutos respecto a UTC, p. ej. −240 = NY
  // en verano). Sin volumen (índices de Yahoo a veces) no hay VWAP: devuelve [].
  function vwap(velas, zonaMin = 0) {
    const out = []; let pv = 0, vv = 0, dia = null;
    for (const v of velas) {
      const vol = v.volume || 0;
      const d = Math.floor((v.time + zonaMin * 60) / 86400);
      if (d !== dia) { dia = d; pv = 0; vv = 0; }
      pv += ((v.high + v.low + v.close) / 3) * vol; vv += vol;
      if (vv > 0) out.push({ time: v.time, value: pv / vv });
    }
    return out;
  }

  // Heikin Ashi (la primera vela: apertura = (O + C) / 2 de la original).
  function heikinAshi(velas) {
    const out = []; let po = null, pc = null;
    for (const v of velas) {
      const c = (v.open + v.high + v.low + v.close) / 4;
      const o = po === null ? (v.open + v.close) / 2 : (po + pc) / 2;
      out.push({ time: v.time, open: o, high: Math.max(v.high, o, c), low: Math.min(v.low, o, c), close: c, volume: v.volume });
      po = o; pc = c;
    }
    return out;
  }

  // Medición entre dos puntos (herramienta «medir»): diferencia, %, velas y tiempo.
  function medir(a, b, segVela) {
    const d = b.precio - a.precio;
    return { diferencia: d, pct: a.precio ? (d / a.precio) * 100 : null, velas: Math.round(Math.abs(b.time - a.time) / segVela),
             segundos: Math.abs(b.time - a.time) };
  }

  // Niveles de Fibonacci entre dos precios (de a → b).
  const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  function fibonacci(a, b) { return FIB.map((k) => ({ nivel: k, precio: b - (b - a) * k })); }

  // Imán: el precio O/H/L/C de la vela más cercano a `precio`.
  function iman(vela, precio) {
    if (!vela) return precio;
    let mejor = vela.close, dist = Infinity;
    for (const k of ['open', 'high', 'low', 'close']) { const dd = Math.abs(vela[k] - precio); if (dd < dist) { dist = dd; mejor = vela[k]; } }
    return mejor;
  }

  // Reproducción: las velas visibles hasta el paso `i` (incluido).
  function hastaPaso(velas, i) { return velas.slice(0, Math.max(0, Math.min(velas.length, i + 1))); }

  return { sma, ema, bollinger, rsi, atr, macd, vwap, heikinAshi, medir, fibonacci, FIB, iman, hastaPaso };
});

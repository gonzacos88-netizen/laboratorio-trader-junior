/* Radar de mercado: no consulta ni representa datos de cuentas. */
'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const simbolo = $('simbolo'), intervalo = $('intervalo'), estado = $('estado');
  const cripto = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT']);
  const fuenteDe = sim => cripto.has(sim) ? 'Binance Spot' : 'Yahoo Finance';
  const publico = location.hostname === 'gonzacos88-netizen.github.io' || new URLSearchParams(location.search).get('publico') === '1';
  const apiPublica = 'https://centinela-mercado.gonzacos88.workers.dev';
  let chart, velas, ema20, ema50, datos = [], secuencia = 0, peticion = null;
  let dibujando = null, primerPunto = null, dibujos = [];
  let reproduciendo = false, posicion = 0, temporizador = null;
  let ultimoEstado = { texto: 'Esperando datos de mercado.', error: false };
  const fechaMadrid = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const numero = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 8 });

  function mensaje(texto, error = false) {
    estado.textContent = texto;
    estado.classList.toggle('error', error);
  }

  function valido(respuesta, sim, iv) {
    if (!respuesta || respuesta.version !== 1 || respuesta.fuente !== fuenteDe(sim)
        || respuesta.simbolo !== sim || respuesta.intervalo !== iv
        || !Array.isArray(respuesta.velas) || !respuesta.velas.length) return false;
    let anterior = 0;
    return respuesta.velas.every(v => {
      if (!Number.isInteger(v.time) || v.time <= anterior
          || !['open', 'high', 'low', 'close'].every(k => Number.isFinite(v[k]) && v[k] > 0)
          || v.high < Math.max(v.open, v.close, v.low)
          || v.low > Math.min(v.open, v.close)
          || (v.volume != null && (!Number.isFinite(v.volume) || v.volume < 0))) return false;
      anterior = v.time;
      return true;
    });
  }

  function visibles() {
    return reproduciendo ? datos.slice(0, posicion + 1) : datos;
  }

  function indicadores() {
    const serie = visibles();
    ema20.setData($('ema20').checked ? IND.ema(serie, 20) : []);
    ema50.setData($('ema50').checked ? IND.ema(serie, 50) : []);
  }

  function controles() {
    const disponible = datos.length > 0 && !peticion && !reproduciendo;
    $('rep-entrar').disabled = !disponible || datos.length < 2;
    $('dib-horizontal').disabled = !disponible;
    $('dib-tendencia').disabled = !disponible;
    $('dib-borrar').disabled = !disponible || !dibujos.length;
    $('dib-horizontal').setAttribute('aria-pressed', String(dibujando === 'horizontal'));
    $('dib-tendencia').setAttribute('aria-pressed', String(dibujando === 'tendencia'));
    $('actualizar').disabled = reproduciendo;
    $('repeticion').hidden = !reproduciendo;
    $('rep-atras').disabled = posicion <= 0;
    $('rep-adelante').disabled = posicion >= datos.length - 1;
    $('rep-play').disabled = posicion >= datos.length - 1 && !temporizador;
    $('rep-play').textContent = temporizador ? 'Pausar' : 'Reproducir';
  }

  function parar() {
    if (temporizador !== null) clearInterval(temporizador);
    temporizador = null;
  }

  function borrarDibujos() {
    for (const dibujo of dibujos) {
      if (dibujo.tipo === 'horizontal') velas.removePriceLine(dibujo.elemento);
      else chart.removeSeries(dibujo.elemento);
    }
    dibujos = [];
    dibujando = null;
    primerPunto = null;
  }

  function pintar(ajustar = false) {
    const serie = visibles();
    velas.setData(serie);
    indicadores();
    if (!serie.length) return;
    if (ajustar) chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, serie.length - 140), to: serie.length + 8 });
    const ultima = serie[serie.length - 1];
    $('titulo-cierre').textContent = reproduciendo ? 'CIERRE HISTÓRICO VISIBLE' : 'ÚLTIMO CIERRE DE VELA';
    $('cierre').textContent = numero.format(ultima.close) + (cripto.has(simbolo.value) ? ' USDT' : '');
    $('detalle').textContent = `${simbolo.value} · ${intervalo.value} · inicio ${reproduciendo ? 'vela visible' : 'última vela'}: ${fechaMadrid.format(new Date(ultima.time * 1000))} (Madrid)`;
    if (reproduciendo) {
      $('rep-pos').max = String(datos.length - 1);
      $('rep-pos').value = String(posicion);
      $('rep-contador').textContent = `Vela ${posicion + 1} de ${datos.length}`;
      mensaje(`Repetición histórica · ${fuenteDe(simbolo.value)} · el refresco está pausado; los datos pueden estar desactualizados.`);
    }
    controles();
  }

  function moverRepeticion(nueva) {
    posicion = Math.max(0, Math.min(datos.length - 1, nueva));
    if (posicion === datos.length - 1) parar();
    pintar(true);
  }

  function salirRepeticion() {
    parar();
    reproduciendo = false;
    pintar(true);
    mensaje(ultimoEstado.texto, ultimoEstado.error);
    controles();
  }

  function seleccionarDibujo(tipo) {
    dibujando = dibujando === tipo ? null : tipo;
    primerPunto = null;
    $('herramienta-estado').textContent = dibujando
      ? dibujando === 'horizontal' ? 'Selecciona un precio en el gráfico.' : 'Selecciona dos puntos en velas distintas.'
      : 'Dibujo cancelado. No se envían órdenes.';
    controles();
  }

  async function consultar(sim, iv, signal) {
    if (publico && cripto.has(sim)) {
      const query = new URLSearchParams({ symbol: sim, interval: iv, limit: '600' });
      const r = await fetch(`https://api.binance.com/api/v3/klines?${query}`, { cache: 'no-store', signal });
      if (!r.ok) throw new Error(`Binance Spot: HTTP ${r.status}`);
      const filas = await r.json();
      if (!Array.isArray(filas) || !filas.every(k => Array.isArray(k) && k.length >= 6))
        throw new Error('Respuesta de Binance incompatible.');
      return { version: 1, fuente: 'Binance Spot', simbolo: sim, intervalo: iv,
        respuesta_utc: new Date().toISOString(), velas: filas.map(k => ({
          time: Math.floor(Number(k[0]) / 1000), open: Number(k[1]), high: Number(k[2]),
          low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
        })) };
    }
    const query = new URLSearchParams({ simbolo: sim, intervalo: iv });
    const r = await fetch(`${publico ? apiPublica : ''}/api/mercado/velas?${query}`, { cache: 'no-store', signal });
    const respuesta = await r.json();
    if (!r.ok) throw new Error(respuesta.error || `HTTP ${r.status}`);
    return respuesta;
  }

  async function cargar(cambio) {
    if (reproduciendo && !cambio) return;
    const sim = simbolo.value, iv = intervalo.value, actual = ++secuencia;
    const ajustar = cambio || !datos.length;
    if (peticion) peticion.abort();
    const control = new AbortController();
    peticion = control;
    if (cambio) {
      parar();
      reproduciendo = false;
      borrarDibujos();
      $('herramienta-estado').textContent = 'Dibujos borrados al cambiar activo o intervalo. No se envían órdenes.';
      datos = [];
      velas.setData([]);
      indicadores();
      $('titulo-cierre').textContent = 'ÚLTIMO CIERRE DE VELA';
      $('cierre').textContent = '—';
      $('detalle').textContent = `${sim} · ${iv} · esperando velas`;
    }
    controles();
    mensaje(`Consultando ${sim} · ${iv}…`);
    try {
      const respuesta = await consultar(sim, iv, control.signal);
      if (!valido(respuesta, sim, iv)) throw new Error('Respuesta de mercado incompatible o sin velas.');
      if (actual !== secuencia) return;
      datos = respuesta.velas;
      pintar(ajustar);
      const fecha = Date.parse(respuesta.respuesta_utc);
      const recibida = Number.isFinite(fecha) ? ` · respuesta ${fechaMadrid.format(new Date(fecha))} (Madrid)` : '';
      ultimoEstado = { texto: `${respuesta.fuente} · ${datos.length} velas${recibida} · caché posible; el proveedor puede tener retraso.`, error: false };
      mensaje(ultimoEstado.texto);
    } catch (e) {
      if (actual !== secuencia || e.name === 'AbortError') return;
      console.warn('Radar de mercado:', e.message);
      ultimoEstado = { texto: `No se pudieron actualizar ${sim} · ${iv}: ${e.message}${datos.length ? ' Se conserva el último gráfico; puede estar desactualizado.' : ''}`, error: true };
      mensaje(ultimoEstado.texto, true);
    } finally {
      if (actual === secuencia) { peticion = null; controles(); }
    }
  }

  try {
    if (!window.LightweightCharts || !window.IND) throw new Error('No se pudo cargar la biblioteca del gráfico.');
    chart = LightweightCharts.createChart($('grafico'), {
      autoSize: true,
      layout: { background: { type: 'solid', color: '#0a0f1d' }, textColor: '#9aa8bf' },
      grid: { vertLines: { color: 'rgba(125,145,185,.07)' }, horzLines: { color: 'rgba(125,145,185,.09)' } },
      rightPriceScale: { borderColor: '#282f49' },
      timeScale: { borderColor: '#282f49', timeVisible: true, secondsVisible: false },
    });
    velas = chart.addCandlestickSeries({
      upColor: '#51d9b2', downColor: '#f07492', borderVisible: false,
      wickUpColor: '#51d9b2', wickDownColor: '#f07492',
    });
    ema20 = chart.addLineSeries({ color: '#e7bf6b', lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    ema50 = chart.addLineSeries({ color: '#83a9ff', lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    chart.subscribeClick(p => {
      if (!dibujando || reproduciendo) return;
      if (!p.point || !p.time) {
        $('herramienta-estado').textContent = 'Selecciona una vela visible dentro del gráfico.';
        return;
      }
      const precio = velas.coordinateToPrice(p.point.y);
      if (!Number.isFinite(precio) || precio <= 0) {
        $('herramienta-estado').textContent = 'Selecciona un precio válido dentro del gráfico.';
        return;
      }
      if (dibujando === 'horizontal') {
        const linea = velas.createPriceLine({ price: precio, color: '#a686f7', lineWidth: 2, axisLabelVisible: true, title: 'Nivel' });
        dibujos.push({ tipo: 'horizontal', elemento: linea });
      } else {
        const punto = { time: p.time, value: precio };
        if (!primerPunto) {
          primerPunto = punto;
          $('herramienta-estado').textContent = 'Primer punto guardado. Selecciona una vela distinta.';
          return;
        }
        if (punto.time === primerPunto.time) {
          $('herramienta-estado').textContent = 'Selecciona una vela distinta para el segundo punto.';
          return;
        }
        const linea = chart.addLineSeries({ color: '#a686f7', lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
        linea.setData([primerPunto, punto].sort((a, b) => a.time - b.time));
        dibujos.push({ tipo: 'tendencia', elemento: linea });
      }
      dibujando = null;
      primerPunto = null;
      $('herramienta-estado').textContent = `Dibujo añadido. ${dibujos.length} en el gráfico; no se envían órdenes.`;
      controles();
    });
    $('dib-horizontal').addEventListener('click', () => seleccionarDibujo('horizontal'));
    $('dib-tendencia').addEventListener('click', () => seleccionarDibujo('tendencia'));
    $('dib-borrar').addEventListener('click', () => {
      borrarDibujos();
      $('herramienta-estado').textContent = 'Dibujos borrados. No se envían órdenes.';
      controles();
    });
    $('rep-entrar').addEventListener('click', () => {
      borrarDibujos();
      $('herramienta-estado').textContent = 'Dibujos borrados para no revelar información futura durante la repetición.';
      reproduciendo = true;
      posicion = Math.max(0, datos.length - 120);
      pintar(true);
    });
    $('rep-atras').addEventListener('click', () => { parar(); moverRepeticion(posicion - 1); });
    $('rep-adelante').addEventListener('click', () => { parar(); moverRepeticion(posicion + 1); });
    $('rep-pos').addEventListener('input', e => { parar(); moverRepeticion(Number(e.target.value)); });
    $('rep-play').addEventListener('click', () => {
      if (temporizador !== null) parar();
      else temporizador = setInterval(() => moverRepeticion(posicion + 1), 650);
      controles();
    });
    $('rep-salir').addEventListener('click', () => { salirRepeticion(); cargar(false); });
    simbolo.addEventListener('change', () => {
      const cuatro = intervalo.querySelector('option[value="4h"]');
      cuatro.disabled = !cripto.has(simbolo.value);
      if (cuatro.disabled && intervalo.value === '4h') intervalo.value = '1h';
      cargar(true);
    });
    intervalo.addEventListener('change', () => cargar(true));
    $('actualizar').addEventListener('click', () => cargar(false));
    $('ema20').addEventListener('change', indicadores);
    $('ema50').addEventListener('change', indicadores);
    cargar(true);
    setInterval(() => {
      if (!document.hidden && !peticion && !reproduciendo && (!window.frameElement || window.frameElement.getClientRects().length)) cargar(false);
    }, 30000);
  } catch (e) {
    console.error('Radar de mercado:', e);
    mensaje(`El gráfico no está disponible: ${e.message}`, true);
  }
})();

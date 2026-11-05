/* =========================================================================
   CAPTURA MAESTRA — motor de leads de la web propia
   -------------------------------------------------------------------------
   Hermano del assets/captura-leads.js de las páginas de ejecutivo, pero
   con dos diferencias de fondo:

   1. NO deriva a ningún WhatsApp. Los leads de esta web son propios y el
      reparto entre ejecutivos se decide después — acá solo se capturan y
      se guardan en la base maestra. Por eso termina en una pantalla de
      confirmación, no en una redirección.

   2. Guarda además lo que la persona calculó (renta, cargas, cotización).
      Ese dato es el que hace valioso al lead: dice cuánto puede pagar.
   ========================================================================= */
(function () {
    'use strict';

    var CONFIG = {
        // URL /exec del Apps Script de la base MAESTRA (no la de ningún ejecutivo).
        endpoint: 'PEGAR_AQUI_URL_DEL_APPS_SCRIPT',

        // En true, los leads quedan marcados es_prueba=SI para no ensuciar
        // las métricas reales. Poner en false antes de largar la campaña.
        modoPrueba: true,

        origen: 'web-maestra',
        vertical: 'salud',
        marca: 'maestra',

        versionPolitica: '2026-11-v2',
        diasAtribucion: 30
    };

    var CLAVE_ATRIBUCION = 'mkt_atribucion_maestra';
    var CAMPOS_UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'];

    /* --------------------------------------------------------------- */
    /* ATRIBUCIÓN                                                       */
    /* --------------------------------------------------------------- */

    function capturarAtribucion() {
        var parametros = new URLSearchParams(window.location.search);
        var tieneUtmEnUrl = CAMPOS_UTM.some(function (campo) { return parametros.has(campo); });
        var guardada = leerAtribucionGuardada();

        // La primera campaña que trajo a la persona manda: si ya hay una
        // guardada y esta visita no trae UTMs nuevos, se respeta la original.
        if (guardada && !tieneUtmEnUrl) return guardada;

        var atribucion = {
            capturada_en: new Date().toISOString(),
            landing: window.location.pathname,
            referrer: document.referrer || 'directo'
        };

        CAMPOS_UTM.forEach(function (campo) {
            atribucion[campo] = parametros.get(campo) || '';
        });

        if (!tieneUtmEnUrl) {
            atribucion.utm_source = clasificarReferrer(document.referrer);
            atribucion.utm_medium = document.referrer ? 'referral' : 'directo';
        }

        guardarAtribucion(atribucion);
        return atribucion;
    }

    function clasificarReferrer(referrer) {
        if (!referrer) return 'directo';
        var host = '';
        try {
            host = new URL(referrer).hostname.replace('www.', '');
        } catch (e) {
            return 'desconocido';
        }
        if (host.indexOf('google') > -1) return 'google';
        if (host.indexOf('facebook') > -1 || host.indexOf('fb.') > -1) return 'facebook';
        if (host.indexOf('instagram') > -1) return 'instagram';
        if (host.indexOf('tiktok') > -1) return 'tiktok';
        if (host.indexOf('whatsapp') > -1) return 'whatsapp';
        if (host.indexOf('youtube') > -1) return 'youtube';
        return host;
    }

    function guardarAtribucion(atribucion) {
        try {
            window.localStorage.setItem(CLAVE_ATRIBUCION, JSON.stringify({
                expira: Date.now() + CONFIG.diasAtribucion * 86400000,
                datos: atribucion
            }));
        } catch (e) {
            /* Modo incógnito o storage bloqueado: seguimos sin persistencia. */
        }
    }

    function leerAtribucionGuardada() {
        try {
            var crudo = window.localStorage.getItem(CLAVE_ATRIBUCION);
            if (!crudo) return null;
            var registro = JSON.parse(crudo);
            if (!registro.expira || Date.now() > registro.expira) {
                window.localStorage.removeItem(CLAVE_ATRIBUCION);
                return null;
            }
            return registro.datos;
        } catch (e) {
            return null;
        }
    }

    /* --------------------------------------------------------------- */
    /* UTILIDADES                                                       */
    /* --------------------------------------------------------------- */

    // Normaliza cualquier formato chileno a 569XXXXXXXX.
    function normalizarTelefono(valor) {
        var digitos = String(valor || '').replace(/\D/g, '');
        if (digitos.indexOf('56') === 0) digitos = digitos.slice(2);
        if (digitos.indexOf('9') === 0 && digitos.length === 9) digitos = digitos.slice(1);
        if (digitos.length !== 8) return null;
        return '569' + digitos;
    }

    function generarIdLead() {
        var aleatorio = Math.random().toString(36).slice(2, 8).toUpperCase();
        var fecha = new Date();
        var sello = String(fecha.getFullYear()).slice(2)
            + String(fecha.getMonth() + 1).padStart(2, '0')
            + String(fecha.getDate()).padStart(2, '0');
        return 'WM-' + sello + '-' + aleatorio;
    }

    function enviarAlBackend(lead) {
        if (!CONFIG.endpoint || CONFIG.endpoint.indexOf('PEGAR_AQUI') === 0) {
            console.warn('[captura-maestra] Endpoint sin configurar. Lead NO guardado:', lead);
            return Promise.resolve({ ok: false, motivo: 'endpoint-sin-configurar' });
        }

        // text/plain evita el preflight CORS, que Apps Script no responde bien.
        return fetch(CONFIG.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(lead)
        })
            .then(function (respuesta) { return { ok: respuesta.ok }; })
            .catch(function (error) {
                console.error('[captura-maestra] Falló el envío:', error);
                return { ok: false, motivo: 'error-de-red' };
            });
    }

    /* --------------------------------------------------------------- */
    /* API PÚBLICA                                                      */
    /* --------------------------------------------------------------- */

    var atribucion = capturarAtribucion();
    var abiertoEn = Date.now();

    /**
     * Arma y envía el lead. Devuelve una promesa con { ok: boolean }.
     *
     * @param {object} datos - lo que la persona escribió y calculó
     */
    function enviarLead(datos) {
        var telefono = normalizarTelefono(datos.telefono);
        if (!telefono) {
            return Promise.resolve({ ok: false, motivo: 'telefono-invalido' });
        }

        var lead = {
            lead_id: generarIdLead(),
            creado_en: new Date().toISOString(),

            // Señuelo anti-spam: lo llena un bot, nunca una persona.
            'sitio-web': datos.senuelo || '',

            nombre: datos.nombre || '',
            telefono: telefono,
            email: datos.email || '',
            comuna: datos.comuna || '',
            edad: datos.edad || '',

            // El sistema NO recoge salud, previsión ni renta: lo calculado
            // en pantalla se queda en el navegador. Solo viaja lo necesario
            // para saber a qué plan puede acceder la persona.
            prevision_actual: datos.previsionActual || '',
            cargas: datos.cargas || 0,

            origen: CONFIG.origen,
            vertical: CONFIG.vertical,
            marca: CONFIG.marca,
            estado: 'nuevo',
            es_prueba: CONFIG.modoPrueba ? 'SI' : '',

            consentimiento: true,
            consentimiento_en: datos.consentidoEn || new Date().toISOString(),
            consentimiento_comercial: datos.comercial ? true : '',
            consentimiento_comercial_en: datos.comercial ? (datos.consentidoComercialEn || new Date().toISOString()) : '',
            politica_version: CONFIG.versionPolitica,

            utm_source: atribucion.utm_source || '',
            utm_medium: atribucion.utm_medium || '',
            utm_campaign: atribucion.utm_campaign || '',
            utm_content: atribucion.utm_content || '',
            utm_term: atribucion.utm_term || '',
            gclid: atribucion.gclid || '',
            fbclid: atribucion.fbclid || '',
            referrer: atribucion.referrer || '',
            landing: atribucion.landing || '',

            user_agent: navigator.userAgent,
            idioma: navigator.language || '',
            segundos_en_pagina: Math.round((Date.now() - abiertoEn) / 1000)
        };

        return enviarAlBackend(lead).then(function (resultado) {
            return { ok: resultado.ok, lead_id: lead.lead_id };
        });
    }

    window.CapturaMaestra = {
        CONFIG: CONFIG,
        enviarLead: enviarLead,
        normalizarTelefono: normalizarTelefono
    };
})();

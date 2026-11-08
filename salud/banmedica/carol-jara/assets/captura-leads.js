/* =========================================================================
   CAPTURA DE LEADS — Motor de captación
   -------------------------------------------------------------------------
   Responsabilidades:
     1. Persistir la atribución (UTMs) durante toda la visita del usuario.
     2. Registrar el consentimiento con fecha, hora y versión de política.
     3. Enviar el lead a la base de datos propia.
     4. Derivar al asesor por WhatsApp sin perder el lead si algo falla.

   Para cambiar de backend (Google Sheets -> API propia) solo se edita
   CONFIG.endpoint. El resto del archivo no cambia.
   ========================================================================= */
(function () {
    'use strict';

    /* ---------------------------------------------------------------------
       CONFIGURACIÓN — lo único que necesitas editar
       --------------------------------------------------------------------- */
    var CONFIG = {
        // URL del Web App de Google Apps Script (ver backend/INSTRUCCIONES.md)
        endpoint: 'PEGAR_AQUI_URL_DEL_APPS_SCRIPT',

        /* -----------------------------------------------------------------
           MODO PRUEBA
           En true, los leads se derivan al WhatsApp de pruebas en vez del
           asesor real, y quedan marcados con es_prueba = SI en la planilla
           para no ensuciar las métricas.

           >>> PONER EN false ANTES DE PUBLICAR EL SITIO <<<
           ----------------------------------------------------------------- */
        modoPrueba: true,
        whatsappPruebas: '56935489006',
        nombrePruebas: 'Alberto (prueba)',

        // WhatsApp del asesor que recibe el lead. Formato internacional sin +
        whatsappAsesor: '56965069051',
        nombreAsesor: 'Carol Jara',

        // Identificadores de la campaña / producto
        asesorId: 'carol-jara',
        vertical: 'salud',
        marca: 'Banmedica',

        // Se sube este número cada vez que cambia el texto de la política.
        // Queda guardado con cada lead como prueba de que consintió ESA versión.
        versionPolitica: '2026-11-v2',

        // Días que se recuerda la campaña de origen del usuario
        diasAtribucion: 30,

        // El panel del administrador pone esto en false si el ejecutivo no
        // está al día con el pago mensual de su página. En false, se oculta
        // el formulario y no se genera ningún lead nuevo.
        cuentaActiva: true
    };

    var CLAVE_ATRIBUCION = 'mkt_atribucion';
    var CAMPOS_UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'];

    /* ---------------------------------------------------------------------
       ATRIBUCIÓN — de qué anuncio vino este lead
       --------------------------------------------------------------------- */

    // Guarda los UTMs la primera vez que llega y los conserva mientras navega.
    // Sin esto no hay forma de saber qué campaña generó la venta.
    function capturarAtribucion() {
        var parametros = new URLSearchParams(window.location.search);
        var tieneUtmEnUrl = CAMPOS_UTM.some(function (campo) {
            return parametros.has(campo);
        });

        var guardada = leerAtribucionGuardada();

        // La primera campaña que trajo al usuario manda. Si ya hay una vigente
        // y esta visita no trae UTMs nuevos, se respeta la original.
        if (guardada && !tieneUtmEnUrl) {
            return guardada;
        }

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

    /* ---------------------------------------------------------------------
       UTILIDADES
       --------------------------------------------------------------------- */

    // Normaliza cualquier formato chileno a 569XXXXXXXX.
    // Acepta: +56 9 1234 5678 / 912345678 / 12345678 / 56912345678
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
        return 'LD-' + sello + '-' + aleatorio;
    }

    // Reemplaza el formulario por un mensaje de agradecimiento genérico,
    // igual para todos los visitantes. A propósito NO delata que la cuenta
    // del ejecutivo está suspendida: el lead se guarda igual del lado del
    // servidor, solo que no se le entrega a nadie todavía.
    function mostrarConfirmacionGenerica(formulario) {
        var contenedor = formulario.closest('section') || formulario.parentElement;
        if (!contenedor) return;
        contenedor.innerHTML =
            '<div style="text-align:center;padding:40px 20px;max-width:500px;margin:0 auto;">'
            + '<h3 style="margin-bottom:10px;">¡Gracias! Recibimos tus datos.</h3>'
            + '<p style="color:#666;">Te contactaremos a la brevedad.</p>'
            + '</div>';
    }

    function leerFormulario(formulario) {
        var datos = {};
        new FormData(formulario).forEach(function (valor, clave) {
            datos[clave] = typeof valor === 'string' ? valor.trim() : valor;
        });
        return datos;
    }

    /* ---------------------------------------------------------------------
       ENVÍO
       --------------------------------------------------------------------- */

    // text/plain evita el preflight CORS, que Apps Script no responde bien.
    function enviarAlBackend(lead) {
        if (!CONFIG.endpoint || CONFIG.endpoint.indexOf('PEGAR_AQUI') === 0) {
            console.warn('[captura-leads] Endpoint sin configurar. Lead no persistido:', lead);
            return Promise.resolve({ ok: false, motivo: 'endpoint-sin-configurar' });
        }

        return fetch(CONFIG.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(lead)
        })
            .then(function (respuesta) {
                return { ok: respuesta.ok };
            })
            .catch(function (error) {
                console.error('[captura-leads] Falló el envío:', error);
                return { ok: false, motivo: 'error-de-red' };
            });
    }

    // En modo prueba todo se desvía al número de pruebas, nunca al asesor real.
    function destinatario() {
        if (CONFIG.modoPrueba) {
            return {
                whatsapp: CONFIG.whatsappPruebas,
                nombre: CONFIG.nombrePruebas
            };
        }
        return {
            whatsapp: CONFIG.whatsappAsesor,
            nombre: CONFIG.nombreAsesor
        };
    }

    function urlWhatsAppAsesor(lead) {
        var destino = destinatario();

        if (!destino.whatsapp || destino.whatsapp.indexOf('PEGAR_AQUI') === 0) {
            console.error('[captura-leads] WhatsApp de destino sin configurar.');
            alert('El sitio aún no tiene configurado el número de destino.');
            return null;
        }

        var mensaje = (CONFIG.modoPrueba ? '[PRUEBA] ' : '')
            + 'Hola ' + destino.nombre + ', soy ' + lead.nombre
            + '. Acabo de solicitar una cotización en tu sitio web'
            + (lead.plan_interes ? ' (' + lead.plan_interes + ')' : '')
            + '. Mi código es ' + lead.lead_id + '.';

        return 'https://wa.me/' + destino.whatsapp + '?text=' + encodeURIComponent(mensaje);
    }

    /* ---------------------------------------------------------------------
       INICIALIZACIÓN
       --------------------------------------------------------------------- */
    function iniciar() {
        var formulario = document.getElementById('form-cotizacion');
        if (!formulario) return;

        var atribucion = capturarAtribucion();
        var abiertoEn = Date.now();

        var campoTelefono = formulario.querySelector('[name="telefono-whatsapp"]');
        var campoConsentimiento = formulario.querySelector('[name="consentimiento-datos"]');
        // Consentimiento SEPARADO para el dato de salud (Ley 21.719: el
        // checkbox único de "acepto la política" no alcanza para datos
        // sensibles — tiene que ser explícito y específico). Si la landing
        // todavía no tiene este segundo checkbox, se degrada con cuidado:
        // no bloquea el envío, pero el campo queda vacío en la planilla.
        // Consentimiento SEPARADO para el dato de salud/previsión (obligatorio).
        var campoConsentimientoSalud = formulario.querySelector('[name="consentimiento-datos-salud"]');
        // Consentimiento COMERCIAL, opcional y separado: no condiciona el servicio.
        var campoConsentimientoComercial = formulario.querySelector('[name="consentimiento-comercial"]');
        var boton = formulario.querySelector('[type="submit"]');
        var textoBotonOriginal = boton ? boton.textContent : '';

        // Momento exacto en que el usuario marcó cada consentimiento.
        // Es la prueba que exige la ley: no basta con que el checkbox esté marcado.
        var consentidoEn = null;
        if (campoConsentimiento) {
            campoConsentimiento.addEventListener('change', function () {
                consentidoEn = campoConsentimiento.checked ? new Date().toISOString() : null;
            });
        }
        var consentidoSaludEn = null;
        if (campoConsentimientoSalud) {
            campoConsentimientoSalud.addEventListener('change', function () {
                consentidoSaludEn = campoConsentimientoSalud.checked ? new Date().toISOString() : null;
            });
        }
        var consentidoComercialEn = null;
        if (campoConsentimientoComercial) {
            campoConsentimientoComercial.addEventListener('change', function () {
                consentidoComercialEn = campoConsentimientoComercial.checked ? new Date().toISOString() : null;
            });
        }

        formulario.addEventListener('submit', function (evento) {
            evento.preventDefault();

            var telefono = normalizarTelefono(campoTelefono ? campoTelefono.value : '');
            if (!telefono) {
                alert('Revisa tu teléfono: debe ser un celular chileno de 9 dígitos. Ej: 9 1234 5678');
                if (campoTelefono) campoTelefono.focus();
                return;
            }

            if (campoConsentimiento && !campoConsentimiento.checked) {
                alert('Necesitamos tu autorización para poder contactarte con la cotización.');
                return;
            }

            if (campoConsentimientoSalud && !campoConsentimientoSalud.checked) {
                alert('Necesitamos tu autorización específica para tratar tus datos de salud/previsión.');
                return;
            }

            var campos = leerFormulario(formulario);
            var lead = {
                lead_id: generarIdLead(),
                creado_en: new Date().toISOString(),

                // Campo señuelo (honeypot) contra spam: un input oculto con
                // CSS en el HTML, name="sitio-web". Un humano nunca lo llena;
                // un bot que rellena todos los campos del formulario sí. El
                // backend (Codigo.gs) descarta el lead en silencio si viene con algo.
                'sitio-web': campos['sitio-web'] || '',

                nombre: campos['nombre-completo'] || '',
                telefono: telefono,
                plan_interes: campos['plan-de-interes'] || '',
                comuna: campos['comuna-residencia'] || '',
                edad: campos['edad-usuario'] || '',
                prevision_actual: campos['prevision-actual'] || '',
                motivo_urgencia: campos['motivo-urgencia'] || '',
                renta_mensual: campos['renta-mensual'] || '',

                // Campos de calificación (bitácora del Marketplace,
                // 2026-09-01): los que más predicen conversión y no se
                // capturaban. Opcionales en el HTML a propósito — no vale
                // la pena perder el lead completo por exigirlos.
                asesor_id: CONFIG.asesorId,
                vertical: CONFIG.vertical,
                marca: CONFIG.marca,
                estado: 'nuevo',
                es_prueba: CONFIG.modoPrueba ? 'SI' : '',

                consentimiento: true,
                consentimiento_en: consentidoEn || new Date().toISOString(),
                // Consentimiento específico para datos de salud (Ley
                // 21.719) — separado del general de arriba. Queda vacío si
                // la landing todavía no tiene el segundo checkbox.
                consentimiento_salud: campoConsentimientoSalud ? true : '',
                consentimiento_salud_en: campoConsentimientoSalud ? (consentidoSaludEn || new Date().toISOString()) : '',
                consentimiento_comercial: (campoConsentimientoComercial && campoConsentimientoComercial.checked) ? true : '',
                consentimiento_comercial_en: (campoConsentimientoComercial && campoConsentimientoComercial.checked) ? (consentidoComercialEn || new Date().toISOString()) : '',
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

            if (boton) {
                boton.disabled = true;
                boton.textContent = 'Enviando...';
            }

            // Pase lo que pase con el backend, el lead llega al asesor.
            // Perder un lead por un fallo de red es inaceptable.
            enviarAlBackend(lead).then(function (resultado) {
                if (!resultado.ok) {
                    console.warn('[captura-leads] Lead no persistido, se deriva igual a WhatsApp.');
                }

                // Cuenta suspendida por falta de pago: el lead ya quedó
                // guardado (el backend lo marca como pendiente de entrega),
                // pero NO se redirige al WhatsApp del ejecutivo — esa
                // redirección es una vía de entrega en vivo que se saltaría
                // el control de pago. El visitante no debe notar nada raro.
                if (!CONFIG.cuentaActiva) {
                    mostrarConfirmacionGenerica(formulario);
                    return;
                }

                var destino = urlWhatsAppAsesor(lead);
                if (!destino) {
                    // Sin destino no hay nada que hacer: devolvemos el botón
                    // para que el usuario pueda reintentar.
                    if (boton) {
                        boton.disabled = false;
                        boton.textContent = textoBotonOriginal;
                    }
                    return;
                }

                window.location.href = destino;
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();

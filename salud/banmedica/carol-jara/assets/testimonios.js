/* =========================================================================
   TESTIMONIOS DE CLIENTES REALES
   -------------------------------------------------------------------------
   Dos responsabilidades, separadas de captura-leads.js a propósito porque
   son datos de naturaleza distinta (contenido público, no un lead privado):
     1. Mostrar los testimonios que Carol ya aprobó (GET ?accion=testimonios).
     2. Recibir testimonios nuevos de clientes reales, con su consentimiento
        explícito para publicar — quedan pendientes de aprobación manual.
   ========================================================================= */
(function () {
    'use strict';

    var ENDPOINT = 'PEGAR_AQUI_URL_DEL_APPS_SCRIPT';

    function generarId() {
        return 'TST-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    }

    /* -----------------------------------------------------------------
       MOSTRAR TESTIMONIOS APROBADOS
       ----------------------------------------------------------------- */
    function cargarTestimonios() {
        var contenedor = document.getElementById('lista-testimonios');
        var seccion = document.getElementById('testimonios');
        if (!contenedor || !seccion) return;

        fetch(ENDPOINT + '?accion=testimonios')
            .then(function (resp) { return resp.json(); })
            .then(function (datos) {
                var testimonios = (datos && datos.testimonios) || [];
                if (testimonios.length === 0) {
                    // Sin testimonios aprobados todavía: la sección se oculta
                    // en vez de mostrarse vacía — una sección vacía se ve peor
                    // que no tenerla.
                    seccion.style.display = 'none';
                    return;
                }
                contenedor.innerHTML = testimonios.map(function (t) {
                    var estrellas = t.calificacion ? '⭐'.repeat(Number(t.calificacion)) : '';
                    var comuna = t.comuna ? ' · ' + escaparHtml(t.comuna) : '';
                    return (
                        '<div class="beneficio-card" style="grid-template-columns: 1fr;">' +
                        '<div class="beneficio-contenido">' +
                        (estrellas ? '<p style="margin-bottom:6px;">' + estrellas + '</p>' : '') +
                        '<p style="font-style: italic;">“' + escaparHtml(t.texto) + '”</p>' +
                        '<h4 style="margin-top:10px; font-size:15px;">' + escaparHtml(t.nombre) + comuna + '</h4>' +
                        '</div></div>'
                    );
                }).join('');
            })
            .catch(function () {
                // Si falla la carga, se oculta la sección en vez de mostrar
                // un error o un hueco vacío al visitante.
                seccion.style.display = 'none';
            });
    }

    function escaparHtml(texto) {
        var div = document.createElement('div');
        div.textContent = String(texto || '');
        return div.innerHTML;
    }

    /* -----------------------------------------------------------------
       ENVIAR UN TESTIMONIO NUEVO
       ----------------------------------------------------------------- */
    function inicializarFormulario() {
        var form = document.getElementById('form-testimonio');
        if (!form) return;

        form.addEventListener('submit', function (evento) {
            evento.preventDefault();

            var consentimiento = document.getElementById('testimonio-consentimiento');
            if (!consentimiento.checked) return;

            var boton = document.getElementById('boton-enviar-testimonio');
            var mensajeEstado = document.getElementById('testimonio-estado');
            boton.disabled = true;
            boton.textContent = 'Enviando...';

            var datos = {
                tipo: 'testimonio',
                testimonio_id: generarId(),
                creado_en: new Date().toISOString(),
                'sitio-web': document.getElementById('testimonio-senuelo').value, // honeypot
                nombre: document.getElementById('testimonio-nombre').value.trim(),
                comuna: document.getElementById('testimonio-comuna').value.trim(),
                calificacion: document.getElementById('testimonio-calificacion').value,
                texto: document.getElementById('testimonio-texto').value.trim(),
                consentimiento_publicar: 'SI',
                consentimiento_en: new Date().toISOString()
            };

            fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' }, // evita preflight CORS
                body: JSON.stringify(datos)
            })
                .then(function (resp) { return resp.json(); })
                .then(function (respuesta) {
                    if (respuesta && respuesta.ok) {
                        form.hidden = true;
                        mensajeEstado.hidden = false;
                    } else {
                        boton.disabled = false;
                        boton.textContent = 'Enviar mi testimonio';
                        alert('No se pudo enviar. Intenta de nuevo en un momento.');
                    }
                })
                .catch(function () {
                    boton.disabled = false;
                    boton.textContent = 'Enviar mi testimonio';
                    alert('No se pudo enviar. Revisa tu conexión e intenta de nuevo.');
                });
        });

        var consentimientoCheck = document.getElementById('testimonio-consentimiento');
        var botonEnviar = document.getElementById('boton-enviar-testimonio');
        consentimientoCheck.addEventListener('change', function () {
            botonEnviar.disabled = !consentimientoCheck.checked;
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        cargarTestimonios();
        inicializarFormulario();
    });
})();

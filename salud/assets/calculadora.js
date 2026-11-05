/* =========================================================================
   CALCULADORA DE COTIZACIÓN DE SALUD — motor de cálculo
   -------------------------------------------------------------------------
   Todo lo que calcula acá es aritmética pública y verificable:
   el 7% legal de cotización, el tope imponible, y la conversión a UF.

   Lo que NO calcula (a propósito) es el precio exacto de un plan: eso
   depende de la isapre, del plan y de la tabla de factores de cada
   persona. Por eso el resultado muestra un RANGO referencial y dice
   claramente que el número exacto lo entrega el asesor. Esa frontera
   entre "dato exacto y gratis" y "número real, previa conversación" es
   justamente lo que hace que valga la pena dejar el teléfono.
   ========================================================================= */
(function (global, exportarComoModulo) {
    'use strict';

    var PARAMETROS = {
        // Cotización legal obligatoria de salud sobre la renta imponible.
        // Fijada por ley, no cambia todos los años.
        PORCENTAJE_COTIZACION: 0.07,

        // Tope imponible para salud, en UF. La Superintendencia de
        // Pensiones lo reajusta cada enero — REVISAR Y ACTUALIZAR una vez
        // al año. Solo afecta a quienes ganan por sobre el tope.
        TOPE_IMPONIBLE_UF: 87.8,

        // Valor de la UF de respaldo. Se usa solo si falla la consulta en
        // vivo a mindicador.cl (ver actualizarUF). Actualizar de vez en
        // cuando para que el respaldo no quede muy viejo.
        UF_RESPALDO: 41000,

        // La cotización se calcula sobre el sueldo IMPONIBLE, pero casi
        // nadie se sabe ese número — la gente conoce su líquido, que es lo
        // que le llega a la cuenta. Los competidores chilenos (tu7.cl)
        // piden el líquido justamente por eso.
        //
        // Los descuentos previsionales son del orden del 20% del imponible
        // (AFP ~11,4% + salud 7% + cesantía ~0,6%), así que:
        //     imponible ≈ líquido / 0,8
        // Es una aproximación, no un cálculo exacto: quien sepa su
        // imponible puede escribirlo directo y se salta esta conversión.
        FACTOR_LIQUIDO_A_IMPONIBLE: 1.25,

        // Rango referencial de lo que cuesta un plan por persona, en UF.
        // NO es un precio de venta: es el rango que se usa para decirle al
        // usuario si su cotización "alcanza holgado", "alcanza justo" o
        // "queda corta". El precio real lo da el asesor.
        PLAN_UF_MINIMO: 2.5,
        PLAN_UF_TIPICO: 3.5,

        // Cuánto encarece, en promedio, cada carga familiar. Referencial,
        // mismo criterio que arriba.
        FACTOR_POR_CARGA: 0.8
    };

    var ufVigente = PARAMETROS.UF_RESPALDO;

    // Intenta traer el valor real de la UF de hoy. Si falla (sin internet,
    // API caída, etc.) se sigue usando el respaldo y la calculadora nunca
    // se queda sin funcionar por esto.
    function actualizarUF() {
        if (!global.fetch) return Promise.resolve(ufVigente);

        return fetch('https://mindicador.cl/api/uf')
            .then(function (r) { return r.json(); })
            .then(function (datos) {
                var valor = datos && datos.serie && datos.serie[0] && datos.serie[0].valor;
                if (valor && valor > 0) ufVigente = valor;
                return ufVigente;
            })
            .catch(function () {
                return ufVigente;
            });
    }

    function valorUF() {
        return ufVigente;
    }

    function pesosAUf(pesos) {
        return pesos / ufVigente;
    }

    function ufAPesos(uf) {
        return uf * ufVigente;
    }

    /**
     * Calcula la cotización obligatoria y qué tan lejos queda de un plan.
     *
     * @param {number} sueldo - sueldo mensual en pesos
     * @param {number} cargas - número de cargas familiares (0 o más)
     * @param {string} tipoSueldo - 'liquido' (por defecto) o 'imponible'
     * @returns {object} el desglose completo, listo para mostrar
     */
    function calcular(sueldo, cargas, tipoSueldo) {
        var sueldoIngresado = Number(sueldo) || 0;
        var esLiquido = tipoSueldo !== 'imponible';

        // Todo el cálculo legal corre sobre el imponible.
        var renta = esLiquido
            ? Math.round(sueldoIngresado * PARAMETROS.FACTOR_LIQUIDO_A_IMPONIBLE)
            : sueldoIngresado;

        var numeroCargas = Math.max(0, Number(cargas) || 0);

        var topeEnPesos = ufAPesos(PARAMETROS.TOPE_IMPONIBLE_UF);
        var rentaAfecta = Math.min(renta, topeEnPesos);
        var superaTope = renta > topeEnPesos;

        var cotizacionPesos = Math.round(rentaAfecta * PARAMETROS.PORCENTAJE_COTIZACION);
        var cotizacionUf = pesosAUf(cotizacionPesos);

        // Cuánto costaría, referencialmente, un plan para este grupo familiar.
        var personas = 1 + numeroCargas;
        var planMinimoUf = PARAMETROS.PLAN_UF_MINIMO + (numeroCargas * PARAMETROS.FACTOR_POR_CARGA);
        var planTipicoUf = PARAMETROS.PLAN_UF_TIPICO + (numeroCargas * PARAMETROS.FACTOR_POR_CARGA);

        // La brecha es lo que habría que poner por sobre la cotización legal.
        var brechaMinimaUf = planMinimoUf - cotizacionUf;
        var brechaTipicaUf = planTipicoUf - cotizacionUf;

        var holgura;
        if (brechaTipicaUf <= 0) {
            holgura = 'holgado';       // la cotización cubre un plan típico
        } else if (brechaMinimaUf <= 0) {
            holgura = 'justo';         // cubre un plan básico, no uno típico
        } else {
            holgura = 'corto';         // hay que poner de más incluso para el básico
        }

        return {
            renta: renta,
            sueldoIngresado: sueldoIngresado,
            eraLiquido: esLiquido,
            cargas: numeroCargas,
            personas: personas,
            superaTope: superaTope,
            topeEnPesos: Math.round(topeEnPesos),
            cotizacionPesos: cotizacionPesos,
            cotizacionUf: cotizacionUf,
            planMinimoUf: planMinimoUf,
            planTipicoUf: planTipicoUf,
            brechaMinimaPesos: Math.round(ufAPesos(Math.max(0, brechaMinimaUf))),
            brechaTipicaPesos: Math.round(ufAPesos(Math.max(0, brechaTipicaUf))),
            holgura: holgura,
            uf: ufVigente
        };
    }

    /**
     * Para quien YA tiene isapre: cuánto pone de su propio bolsillo por
     * sobre el 7% que la ley ya le descuenta.
     *
     * Este es el número que de verdad mueve a la persona. El 7% lo paga
     * igual, con o sin isapre: no lo siente como gasto propio. Lo que sí
     * duele es la diferencia que sale de su sueldo líquido todos los
     * meses — y en un año eso ya es plata visible.
     *
     * @param {number} pagoMensual - lo que paga hoy por su plan, en pesos
     * @param {object} calculo - lo que devolvió calcular()
     */
    function analizarPagoActual(pagoMensual, calculo) {
        var pago = Number(pagoMensual) || 0;
        if (!pago) return null;

        var deSuBolsillo = Math.max(0, pago - calculo.cotizacionPesos);
        var pagoUf = pesosAUf(pago);

        // ¿Lo que paga está por encima de lo que cuesta un plan típico
        // para su grupo familiar? Si es así, hay margen para mejorar.
        var planTipicoPesos = ufAPesos(calculo.planTipicoUf);
        var margen = pago - planTipicoPesos;

        return {
            pagoMensual: pago,
            pagoUf: pagoUf,
            deSuBolsillo: deSuBolsillo,
            deSuBolsilloAlAno: deSuBolsillo * 12,
            margen: Math.round(margen),
            hayMargen: margen > 0
        };
    }

    function formatearPesos(monto) {
        return '$' + Math.round(monto).toLocaleString('es-CL');
    }

    function formatearUf(uf) {
        return uf.toFixed(2).replace('.', ',') + ' UF';
    }

    var api = {
        PARAMETROS: PARAMETROS,
        actualizarUF: actualizarUF,
        valorUF: valorUF,
        calcular: calcular,
        analizarPagoActual: analizarPagoActual,
        formatearPesos: formatearPesos,
        formatearUf: formatearUf
    };

    global.Calculadora = api;

    // El bot de WhatsApp (Node) usa exactamente este mismo archivo. Sin
    // esto habría que repetir el 7%, el tope imponible y la conversión de
    // líquido a imponible en dos lugares — y tarde o temprano se
    // desincronizan y la web y el bot le dicen números distintos a la
    // misma persona.
    if (exportarComoModulo) {
        module.exports = api;
    }
})(
    typeof window !== 'undefined' ? window : globalThis,
    typeof module !== 'undefined' && module.exports
);

const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const axios = require('axios');
let procesandoEnvio = false;

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const dbConfig = {
  user: 'Logic',
  password: 'Sage2009++',
  server: 'VSAGE-SPAINSIS',
  database: 'Sage',
  options: {
    trustServerCertificate: true,
    enableArithAbort: true
  }
};


const truncar = (texto, max) => (texto?.toString().substring(0, max) ?? '');
const generarCodigoArticulo = (descripcion) => 'ART' + descripcion.replace(/\s+/g, '').substring(0, 10).toUpperCase();

let ejecutando = false;

async function insertarPedidoDesdeBody(data) {
  if (ejecutando) {
    console.log('⏳ Ya se está ejecutando una inserción. Esperando...');
    return { success: false, message: 'Inserción en curso' };
  }

  ejecutando = true;

  try {
    await sql.connect(dbConfig);
    const ejercicioActual = new Date().getFullYear();
    const fechaActual = new Date().toISOString().split('T')[0]; // formato YYYY-MM-DD

    for (const cliente of data.Clientes) {
      const cifDni = truncar(cliente.CifDni, 13);
      let codigoCliente;
      let codigoContable;

      const clienteExistente = await sql.query`SELECT * FROM Clientes WHERE CifDni = ${cifDni} AND CodigoEmpresa = 9999`;
      if (clienteExistente.recordset.length === 0) {
        const resultadoUltimo = await sql.query`
          SELECT TOP 1 CodigoCliente FROM Clientes
          WHERE ISNUMERIC(CodigoCliente) = 1 AND CodigoEmpresa = 9999
          ORDER BY CAST(CodigoCliente AS INT) DESC
        `;
        const ultimoCodigo = resultadoUltimo.recordset.length > 0
          ? parseInt(resultadoUltimo.recordset[0].CodigoCliente, 10)
          : 0;

        codigoCliente = (ultimoCodigo + 1).toString().padStart(6, '0');
        codigoContable = '430000' + codigoCliente;

        await sql.query`
          INSERT INTO Clientes (CodigoCliente, CifDni, Nombre, CodigoEmpresa, CodigoContable)
          VALUES (${codigoCliente}, ${cifDni}, 'Cliente Dynamics', 9999, ${codigoContable})
        `;
      } else {
        codigoCliente = clienteExistente.recordset[0].CodigoCliente;
        codigoContable = clienteExistente.recordset[0].CodigoContable;
      }

      for (const cabecera of data.CabeceraPedidoCliente) {
        // Extrae el número del centro del NumeroPedidoCRM (ej. ORD-01562-K8Q4M6 → 1562)
        const numeroPedido = cabecera.NumeroPedidoCRM?.split('-')[1]?.replace(/^0+/, '') || '0';

        const razonSocial = truncar(cabecera.NombreEmpresa, 40);
        const cifDniCabecera = truncar(cabecera.AccountId, 13);
const accountId = truncar(cabecera.AccountId, 50); // longitud según tu tabla

        const cifEuropeo = 'ES';

        const cabeceraExistente = await sql.query`
          SELECT 1 FROM CabeceraPedidoCliente 
          WHERE CodigoEmpresa = 9999 AND EjercicioPedido = ${ejercicioActual} AND NumeroPedido = ${numeroPedido}
        `;
        if (cabeceraExistente.recordset.length > 0) continue;



        let importeBruto = 0;
        let importeDescuento = 0;

        for (const linea of cabecera.LineasPedidoCliente) {
          const descripcion = truncar(linea.DescripcionArticulo, 50);
          const unidades = parseFloat(linea.UnidadesPedidas || 0);
          const precio = parseFloat(linea.Precio || 0);
          const porcentajeDescuento = parseFloat(linea.PorcentajeDescuento || 0);
          const descuentoCantidad = parseFloat(linea.DescuentoEnCantidad || 0);
/*
          const articuloExistente = await sql.query`
            SELECT CodigoArticulo FROM Articulos WHERE DescripcionArticulo = ${descripcion} AND CodigoEmpresa = 9999
          `;



          let codigoArticulo;
          if (articuloExistente.recordset.length === 0) {
            codigoArticulo = generarCodigoArticulo(descripcion);
            await sql.query`
              INSERT INTO Articulos (CodigoEmpresa, CodigoArticulo, DescripcionArticulo)
              VALUES (9999, ${codigoArticulo}, ${descripcion})
            `;
          } else {
            codigoArticulo = articuloExistente.recordset[0].CodigoArticulo;
          }
*/
          const subtotal = unidades * precio;
          let descuento = 0;

          if (!isNaN(porcentajeDescuento) && porcentajeDescuento > 0) {
            descuento = subtotal * (porcentajeDescuento / 100);
          } else if (!isNaN(descuentoCantidad) && descuentoCantidad > 0) {
            descuento = descuentoCantidad;
          }

          importeBruto += subtotal;
          importeDescuento += descuento;
          const importeLiquidoLinea = subtotal - descuento;

await sql.query`
  INSERT INTO LineasPedidoCliente (
    CodigoEmpresa, EjercicioPedido, NumeroPedido, CodigoArticulo, DescripcionArticulo,
    UnidadesPedidas,UnidadesPendientes, Unidades2_, Precio, CodigoAlmacen,
    [%Descuento], ImporteDescuento, ImporteLiquido
  ) VALUES (
    9999, ${ejercicioActual}, ${numeroPedido}, 'GENERICO', ${descripcion},
    ${unidades}, ${unidades},${unidades}, ${precio}, 'CEN',
    ${!isNaN(porcentajeDescuento) ? porcentajeDescuento : null},
    ${!isNaN(descuentoCantidad) ? descuento : null},
    ${importeLiquidoLinea}
  )
`;

        }

        const importeNeto = importeBruto - importeDescuento;
        const importeLiquido = importeNeto;
        const numeroLineas = cabecera.LineasPedidoCliente.length;



console.log('📌 Estado recibido:', cabecera.Estado);

if (cabecera.Estado === 2) {
  const numeroPedidoCRM = cabecera.NumeroPedidoCRM;
  const numeroPedidoFormateado = `ORD-${numeroPedido.padStart(5, '0')}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  try {
    await axios.post(
      'https://prod-05.westeurope.logic.azure.com/workflows/c6dd977a525345f287436e9a683199ab/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=9ZmHqMYmOQDPRxsV3tF2zLgIgBlO0kqYVmi89PmojCw',
      {
        AccountId: cabecera.AccountId,
        NumeroPedido: numeroPedidoCRM,
        FechaPedido: fechaActual,
        BaseImponible: importeNeto,
        ImporteLiquido: importeLiquido,
        TotalCuotaIva: importeLiquido - importeNeto,
        Estado: 2
      }
    );
    console.log(`✅ Pedido ${numeroPedidoCRM} enviado a Dynamics`);
  } catch (err) {
    console.error(`❌ Error al notificar Dynamics para ${numeroPedidoCRM}:`, err.message);
  }
}


await sql.query`
  INSERT INTO CabeceraPedidoCliente (
    CodigoEmpresa, EjercicioPedido, NumeroPedido, NumeroPedidoCRM,
    FechaPedido, FechaNecesaria, FechaEntrega, FechaTope,
    CifDni, CodigoCliente, RazonSocial, CodigoContable, CifEuropeo,
    NumeroLineas,
    ImporteBruto, ImporteDescuentoLineas, ImporteNetoLineas, ImporteLiquido,
    AccountId
  ) VALUES (
    9999, ${ejercicioActual}, ${numeroPedido}, ${cabecera.NumeroPedidoCRM},
    ${fechaActual}, ${fechaActual}, ${fechaActual}, ${fechaActual},
    ${cifDniCabecera}, ${codigoCliente}, ${razonSocial}, ${codigoContable}, ${cifEuropeo},
    ${numeroLineas},
    ${importeBruto}, ${importeDescuento}, ${importeNeto}, ${importeLiquido},
    ${cabecera.AccountId}
  )
`;


      }
    }

    return { success: true, message: 'Pedido insertado correctamente en Sage' };
  } catch (error) {
    console.error('❌ Error:', error);
    return { success: false, message: 'Error en la inserción', error: error.message };
  } finally {
    ejecutando = false;
    await sql.close();
  }
}

// 📌 Endpoint POST que procesa el JSON y lo inserta en Sage
app.post('/postSage', async (req, res) => {
  const datos = req.body;
  console.log('📦 JSON recibido:', JSON.stringify(datos, null, 2));

  try {
    const resultado = await insertarPedidoDesdeBody(datos);
    res.status(resultado.success ? 200 : 500).json(resultado);
  } catch (err) {
    console.error('❌ Error inesperado en el endpoint /postSage:', err.message);
    res.status(500).json({ success: false, message: 'Error interno del servidor', error: err.message });
  }
});


async function enviarPedidosEstado2() {
  if (procesandoEnvio) {
    console.log('⏳ Envío en curso, se omite esta ejecución.');
    return;
  }

  procesandoEnvio = true;
  try {
    await sql.connect(dbConfig);
    await sql.query`EXEC sp_GenerarFacturasPendientes`;
    console.log('✅ sp_GenerarFacturasPendientes ejecutado.');
    
    const resultado = await sql.query(`
      SELECT NumeroPedido, NumeroPedidoCRM, AccountId, FechaPedido, 
             ImporteNetoLineas AS BaseImponible, ImporteLiquido, 
             (ImporteLiquido - ImporteNetoLineas) AS TotalCuotaIva, Estado
      FROM CabeceraPedidoCliente
      WHERE CodigoEmpresa = 9999 
        AND Estado = 2 
        AND NumeroPedidoCRM IS NOT NULL 
        AND LTRIM(RTRIM(NumeroPedidoCRM)) <> ''
        AND EnviadoDynamics IS NULL
    `);

    for (const pedido of resultado.recordset) {
      const facturaRes = await sql.query`
        SELECT TOP 1 NumeroFactura
        FROM CabeceraAlbaranCliente
        WHERE CodigoEmpresa = 9999 AND NumeroPedido = ${pedido.NumeroPedido}
          AND NumeroFactura IS NOT NULL
      `;

      const numeroFactura = facturaRes.recordset.length > 0 ? facturaRes.recordset[0].NumeroFactura : null;

      if (!numeroFactura) {
        console.warn(`⚠️ Pedido ${pedido.NumeroPedido} sin factura. Omitido.`);
        continue;
      }

      const payload = {
        AccountId: pedido.AccountId,
        NumeroPedido: pedido.NumeroPedidoCRM,
        FechaPedido: pedido.FechaPedido?.toISOString().split('T')[0],
        BaseImponible: Math.round(pedido.BaseImponible),
        ImporteLiquido: Math.round(pedido.ImporteLiquido),
        TotalCuotaIva: Math.round(pedido.TotalCuotaIva),
        Estado: pedido.Estado,
        NumeroFactura: numeroFactura
      };

      console.log('📤 Enviando pedido a Dynamics:', payload);

      try {
        await axios.post(
          'https://prod-05.westeurope.logic.azure.com/workflows/c6dd977a525345f287436e9a683199ab/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=9ZmHqMYmOQDPRxsV3tF2zLgIgBlO0kqYVmi89PmojCw',
          payload
        );

        await sql.query`
          UPDATE CabeceraPedidoCliente 
          SET EnviadoDynamics = GETDATE()
          WHERE CodigoEmpresa = 9999 AND NumeroPedido = ${pedido.NumeroPedido}
        `;
      } catch (error) {
        console.error(`❌ Error al enviar pedido ${pedido.NumeroPedidoCRM}:`, error.message);
      }
    }
  } catch (error) {
    console.error('❌ Error general en el envío:', error.message);
  } finally {
    procesandoEnvio = false;
    await sql.close();
  }
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Rechazo no manejado:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('🚨 Excepción no controlada:', err);
});


// Ejecutar cada 30 segundos
setInterval(enviarPedidosEstado2, 30000);


app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
});

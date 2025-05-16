const express = require('express');
const sql = require('mssql');
const cors = require('cors');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const dbConfig = {
  user: 'logic',
  password: 'Sage2024+',
  server: 'SVRALANDALUS',
  database: 'DEMOS',
  options: {
    trustServerCertificate: true,
    enableArithAbort: true,
    requestTimeout: 60000
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
              UnidadesPedidas, Unidades2_, Precio, CodigoAlmacen,
              [%Descuento], ImporteDescuento, ImporteLiquido
            ) VALUES (
              9999, ${ejercicioActual}, ${numeroPedido}, ${codigoArticulo}, ${descripcion},
              ${unidades}, ${unidades}, ${precio}, '001',
              ${!isNaN(porcentajeDescuento) ? porcentajeDescuento : null},
              ${!isNaN(descuentoCantidad) ? descuento : null},
              ${importeLiquidoLinea}
            )
          `;
        }

        const importeNeto = importeBruto - importeDescuento;
        const importeLiquido = importeNeto;
        const numeroLineas = cabecera.LineasPedidoCliente.length;

        await sql.query`
          INSERT INTO CabeceraPedidoCliente (
            CodigoEmpresa, EjercicioPedido, NumeroPedido,
            FechaPedido, FechaNecesaria, FechaEntrega, FechaTope,
            CifDni, CodigoCliente, RazonSocial, CodigoContable, CifEuropeo,
            NumeroLineas,
            ImporteBruto, ImporteDescuentoLineas, ImporteNetoLineas, ImporteLiquido
          ) VALUES (
            9999, ${ejercicioActual}, ${numeroPedido},
            ${fechaActual}, ${fechaActual}, ${fechaActual}, ${fechaActual},
            ${cifDniCabecera}, ${codigoCliente}, ${razonSocial}, ${codigoContable}, ${cifEuropeo},
            ${numeroLineas},
            ${importeBruto}, ${importeDescuento}, ${importeNeto}, ${importeLiquido}
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

  const resultado = await insertarPedidoDesdeBody(datos);
  res.status(resultado.success ? 200 : 500).json(resultado);
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
});

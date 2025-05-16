const express = require('express');
const sql = require('mssql');
const fs = require('fs');

const app = express();
const PORT = 3000;

const pedidosExportados = [];

app.get('/api/pedidos-estado-2', async (req, res) => {
  try {
    await sql.connect(dbConfig);

    const resultado = await sql.query`
      SELECT
        CifDni AS AccountId,
        NumeroPedido,
        FechaPedido,
        ImporteNetoLineas AS BaseImponible,
        ImporteLiquido,
        (ImporteLiquido - ImporteNetoLineas) AS TotalCuotaIva,
        Estado
      FROM CabeceraPedidoCliente
      WHERE Estado = 2 AND CodigoEmpresa = 9999
    `;

    res.json(resultado.recordset);
  } catch (error) {
    console.error('❌ Error al obtener pedidos con Estado = 2:', error);
    res.status(500).json({ error: 'Error al consultar la base de datos.' });
  } finally {
    await sql.close();
  }
});


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

async function insertarPedidoDesdeJSON(jsonPath) {
  if (ejecutando) {
    console.log('⏳ Ya se está ejecutando una inserción. Esperando el siguiente intervalo...');
    return;
  }

  ejecutando = true;

  try {
    const rawData = fs.readFileSync(jsonPath);
    const data = JSON.parse(rawData);
    await sql.connect(dbConfig);
    const ejercicioActual = new Date().getFullYear();

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
        console.log(`✅ Cliente ${codigoCliente} insertado con CódigoContable ${codigoContable}.`);
      } else {
        codigoCliente = clienteExistente.recordset[0].CodigoCliente;
        codigoContable = clienteExistente.recordset[0].CodigoContable;
        console.log(`ℹ️ Cliente con CIF ${cifDni} ya existe (Código ${codigoCliente}).`);
      }

      for (const cabecera of data.CabeceraPedidoCliente) {
        const numeroPedido = truncar(cabecera.NumeroPedido, 10);
        const fechaPedido = cabecera.FechaPedido;
        const razonSocial = truncar(cabecera.NombreEmpresa, 40);
        const cifDniCabecera = truncar(cabecera.AccountId, 13);
        const cifEuropeo = 'ES';

        const cabeceraExistente = await sql.query`
          SELECT 1 FROM CabeceraPedidoCliente 
          WHERE CodigoEmpresa = 9999 AND EjercicioPedido = ${ejercicioActual} AND NumeroPedido = ${numeroPedido}
        `;
        if (cabeceraExistente.recordset.length > 0) {
          console.log(`⚠️ Pedido ${numeroPedido} ya existe. Se omite la inserción.`);
          continue;
        }

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
            console.log(`🆕 Artículo ${codigoArticulo} insertado.`);
          } else {
            codigoArticulo = articuloExistente.recordset[0].CodigoArticulo;
            console.log(`🔁 Artículo ${codigoArticulo} ya existe.`);
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
            ${fechaPedido}, ${fechaPedido}, ${fechaPedido}, ${fechaPedido},
            ${cifDniCabecera}, ${codigoCliente}, ${razonSocial}, ${codigoContable}, ${cifEuropeo},
            ${numeroLineas},
            ${importeBruto}, ${importeDescuento}, ${importeNeto}, ${importeLiquido}
          )
        `;

        console.log(`✅ Pedido ${numeroPedido} y sus líneas insertados con cliente ${codigoCliente}.`);

        // 🔄 Comprobación de Estado = 2 para exponer por API
        if (cabecera.Estado === 2) {
          const pedidoJson = {
            AccountId: cifDniCabecera,
            NumeroPedido: parseInt(numeroPedido),
            FechaPedido: fechaPedido,
            BaseImponible: importeNeto,
            ImporteLiquido: importeLiquido,
            TotalCuotaIva: Math.round((importeLiquido - importeNeto) * 100) / 100,
            Estado: 2
          };

          pedidosExportados.push(pedidoJson);
          console.log(`📤 Pedido con estado 2 disponible en API: /api/pedidos-estado-2`);
        }
      }
    }

    console.log('✅ Inserción completada.');
    await sql.close();
  } catch (error) {
    console.error('❌ Error en la inserción:', error);
    await sql.close();
  } finally {
    ejecutando = false;
  }
}

// Ejecutar cada 30 segundos
setInterval(() => {
  insertarPedidoDesdeJSON('./pedido-dynamics.json');
}, 30000);

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});


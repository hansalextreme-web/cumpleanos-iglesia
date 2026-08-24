export default async function handler(req, res) {
    // Configurar cabeceras CORS si es necesario que se consuma desde otro dominio
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');

    // Manejar la petición OPTIONS para CORS (pre-flight)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Asegurar que solo procesamos peticiones POST
    if (req.method === 'POST') {
        try {
            const nuevoRegistro = req.body;

            // Validación básica
            if (!nuevoRegistro) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Faltan datos en la petición' 
                });
            }

            console.log('Datos recibidos en el servidor:', nuevoRegistro);
            
            // Aquí iría tu lógica de guardado en Base de Datos (Firebase, etc.)

            return res.status(201).json({
                success: true,
                message: 'Registro guardado exitosamente',
                data: nuevoRegistro
            });
        } catch (error) {
            console.error('Error en el servidor:', error);
            return res.status(500).json({ 
                success: false, 
                error: 'Error interno al procesar los datos' 
            });
        }
    }
    
    // Si intentan acceder con GET, PUT, etc.
    return res.status(405).json({ 
        success: false, 
        message: 'Método no permitido' 
    });
}

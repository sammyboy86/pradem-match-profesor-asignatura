FROM node:20-bookworm

# ══════════════════════════════════════════════════════════════
#  1. Dependencias del sistema (descomente según necesidad)
# ══════════════════════════════════════════════════════════════
# Si la herramienta necesita Python:
# RUN apt-get update && apt-get install -y python3 python3-pip

# 2. Configurar el directorio de trabajo
WORKDIR /app

# 3. Instalar dependencias de Node.js
COPY package.json package-lock.json* ./
RUN npm install

# Si la herramienta necesita dependencias de Python:
# RUN pip3 install <paquetes> --break-system-packages

# 4. Copiar el resto del código fuente
COPY . .

# 5. Construir el proyecto Next.js
RUN npm run build

# 6. Exponer el puerto (Railway inyecta la variable PORT, Next.js la usa por defecto)
EXPOSE 3000

# 7. Comando para iniciar la aplicación en producción
CMD ["npm", "run", "start"]

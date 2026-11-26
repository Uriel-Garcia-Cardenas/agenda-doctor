# CitaDental — Agenda minimalista

## 1. Crear proyecto en Firebase
1. https://console.firebase.google.com → **Agregar proyecto**
2. Menú **Firestore Database** → crear → modo **producción** → región más cercana
3. Menú **Authentication** → **Comenzar** → habilitar **Correo/contraseña**
4. Menú **Authentication → Users → Add user** → crea el correo y contraseña del doctor
   (este será el login del panel admin)

## 2. Configurar firestore.rules
- Firestore → **Reglas** → pega el contenido de `firestore.rules` → **Publicar**

## 3. Obtener credenciales
- Firebase → ⚙️ Configuración → **Tus apps** → Agregar app (Web)
- Copia el objeto `firebaseConfig` y pégalo en `firebase-config.js`

## 4. Desplegar en GitHub Pages
```bash
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
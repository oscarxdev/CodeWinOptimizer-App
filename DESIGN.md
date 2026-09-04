# CodeWinOptimizer — Design System

<!-- impeccable:design-schema 1 -->

## Direction

Windows 11 nativo (Fluent dark). La app se lee como una página más de Configuración de Windows: superficies planas gris-carbón, divisores sutiles, tipografía Segoe UI Variable, radios de 4-8px y un solo acento — el verde del logo (#39ff14) — reservado para acciones primarias, selección y semáforos. Nada de gradientes, glows, emojis, ni iconos multicolor. Es la estética que un desarrollador de Windows entregaría, no la que un generador produce.

## Color

- Fondo: `#202020`; tarjetas/paneles: `#2b2b2b`; hover: `rgba(255,255,255,0.05)`
- Divisores: `rgba(255,255,255,0.07)`
- Texto: `#fff`, secundario `rgba(255,255,255,0.74)`, terciario `rgba(255,255,255,0.58)`
- Acento (mutable en Ajustes): `#39ff14` verde logo — botón primario, toggle ON, indicador de pestaña activa, foco, enlaces
- Estado: ok `var(--gn)`, medio `#f5b942`, alto `#ff99a4` (badges de impacto semánticos)

## Tipografía

- UI: `Segoe UI Variable Text → Segoe UI → system-ui`, 13px base
- Títulos de página: `Segoe UI Variable Display`, 22px/600
- Datos y terminal: `Cascadia Mono` (latencia, comandos, logs, rutas)
- Nada de uppercase con tracking como decoración; los labels son sentence case

## Geometría

- Radios: 4px controles, 8px paneles/tarjetas/diálogo, pill en toggles y badges
- Sombras solo en elevación real (flyout de ajustes, diálogo). Sin sombras por tarjeta
- Barras de progreso: track `rgba(255,255,255,0.1)` 4px, fill animado con `transform: scaleX` (sin layout thrash)

## Componentes

- **Titlebar**: 40px, logo 18px + nombre 12px/600 + versión; botones de ventana 46px con hover gris y close `#c42b1c`
- **Nav tabs**: top-nav estilo Windows 11, icono+label 12.5px; activo = texto blanco 600 + subrayado verde 2px + icono verde
- **Botones**: `.btn` relleno `rgba(255,255,255,0.07)` sin borde; `.btn-accent` verde con texto casi negro; `.btn-danger` outline rojo suave
- **Toggle**: switch 40×20 al estilo Win 11, knob blanco OFF / verde con knob oscuro ON (contraste sobre acento claro)
- **Checks dibujados**: `.sel-ico` y `.cleanup-item::after` son cajas SVG/✓ reales, no caracteres ☐/☑ ni emojis
- **Iconos**: trazo 1.7-1.8 uniforme `currentColor`; los iconos de marca (Patreon/PayPal) neutros en gris
- **Filas de lista**: separadas por divisor `rgba(255,255,255,0.07)`, hover sutil, sin borde lateral de color
- **Selección**: fill verde 5-13% + toggle, nunca borde lateral ni glow

## Comportamiento

- Pestañas Apps/Tweaks con encabezado sticky de fondo sólido
- Terminal derecha colapsable a rail de 32px, fondo `#171717` y mono 11.5px
- Contenido scrolleable por pestaña (`.tab-content.active` flex + overflow)
- Responsive: grids colapsan 2→1 col; <760px la terminal se vuelve panel overlay

## States

- Hover = fill blanco 5-9% (nunca glow); disabled = opacidad 0.4
- Focus = outline 2px verde (inputs: borde verde)
- Errores/banners = tint del color semántico con icono de línea

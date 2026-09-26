# Windows 0.3.1

Сборка из актуального интерфейса:

```sh
pnpm --dir platform build:ui
cd apps/desktop
npm ci
npm run dist:win
```

Результат: `release/Otschet-Windows-x64-<версия>.zip`. Распакуйте весь архив и запустите `Otschet.exe`; не запускайте exe отдельно от соседних файлов. Сборки до 0.3.3 включительно называются `ITles-…`.

Сборка не подписана сертификатом Windows. Проверены целостность ZIP, версия пакета и включение актуального веб-интерфейса. Запуск на Windows не проверен. NSIS-установщик (`npm run dist:win:installer`) требует Wine при сборке на Linux; в выпуск 25.09 включён ZIP, не установщик.

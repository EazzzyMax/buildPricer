// ==UserScript==
// @name         POE Ninja Build Exporter for Build Pricer
// @namespace    http://tampermonkey.net/
// @version      8.0
// @description  Adds a button to copy character items directly from DOM (Zero API Requests, Smart Extract V3)
// @match        *://poe.ninja/*/builds/*/character/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    function log(msg, ...data) {
        console.log(`[POE Ninja Exporter] ${msg}`, ...data);
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Полная симуляция наведения мыши для React / Tippy / Floating-UI
    function emulateHover(el) {
        const rect = el.getBoundingClientRect();
        const hoverParams = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2
        };
        el.dispatchEvent(new PointerEvent('pointerover', hoverParams));
        el.dispatchEvent(new PointerEvent('pointerenter', hoverParams));
        el.dispatchEvent(new MouseEvent('mouseover', hoverParams));
        el.dispatchEvent(new MouseEvent('mouseenter', hoverParams));
        el.dispatchEvent(new MouseEvent('mousemove', hoverParams));
        el.dispatchEvent(new FocusEvent('focus', hoverParams));
    }

    function emulateUnhover(el) {
        const unhoverParams = { bubbles: true, cancelable: true, view: window };
        el.dispatchEvent(new PointerEvent('pointerout', unhoverParams));
        el.dispatchEvent(new PointerEvent('pointerleave', unhoverParams));
        el.dispatchEvent(new MouseEvent('mouseout', unhoverParams));
        el.dispatchEvent(new MouseEvent('mouseleave', unhoverParams));
        el.dispatchEvent(new FocusEvent('blur', unhoverParams));
    }

    async function extractFromDOM(btn) {
        const originalText = btn.innerText;
        btn.innerText = 'Сбор данных с экрана...';
        log("Начат сбор данных с экрана (DOM Parsing V8.0)");

        try {
            const slotsNodes = document.querySelectorAll('div[style*="grid-area"]');
            log(`Всего элементов с атрибутом grid-area: ${slotsNodes.length}`);

            const items = [];
            const slotMap = {
                'Weapon': 'Weapon',
                'Offhand': 'Offhand',
                'Helm': 'Helm',
                'BodyArmour': 'BodyArmour',
                'Gloves': 'Gloves',
                'Boots': 'Boots',
                'Amulet': 'Amulet',
                'Ring2': 'Ring2',
                'Ring': 'Ring',
                'Belt': 'Belt',
                'Jewel': 'Jewel',
                'ClusterJewel': 'ClusterJewel'
            }; // Фласки убрали из стандартного маппинга, так как они вложены

            const slotKeysSorted = Object.keys(slotMap).sort((a, b) => b.length - a.length);

            // Обычные шмотки + Самоцветы
            const validNodes = Array.from(slotsNodes).filter(n => {
                const ga = n.style.gridArea;
                return ga && slotKeysSorted.some(k => ga.startsWith(k)) && n.hasAttribute('data-tooltip-id');
            });

            // Находим контейнер фласок и достаем их изнутри
            const flaskContainers = Array.from(slotsNodes).filter(n => {
                return n.style.gridArea && n.style.gridArea.startsWith('Flask');
            });

            for (const fc of flaskContainers) {
                // Ищем любые элементы внутри контейнера фласок, у которых есть тултип
                const flasks = fc.querySelectorAll('[data-tooltip-id]');
                flasks.forEach(f => {
                    f.dataset.forcedSlot = 'Flask';
                    validNodes.push(f);
                });
            }

            // [NEW] Поиск джевелов вне основной сетки (в списках и секциях)
            const allPossibleItems = document.querySelectorAll('[data-tooltip-id]');
            for (const item of allPossibleItems) {
                // Если мы его уже добавили или это вложенный элемент (например, гем в сокете шмотки)
                if (validNodes.includes(item)) continue;
                if (validNodes.some(v => v.contains(item))) continue;

                // [NEW] Поиск предметов вне основной сетки (например, джевелов в списках)
                // 1. Сначала проверяем наличие иконки — предметы их всегда имеют, а статистика нет.
                const comp = window.getComputedStyle(item);
                const bgImage = item.style.backgroundImage || comp.backgroundImage || '';
                const borderImage = item.style.borderImageSource || comp.borderImageSource || item.style.borderImage || '';
                const hasImg = item.querySelector('img');
                const hasIcon = bgImage.includes('url') || borderImage.includes('url') || hasImg;
                if (!hasIcon) continue;

                // 2. Определяем категорию (Cluster/Base/Other)
                let forced = null;
                const ga = item.style.gridArea || '';

                // Сначала пробуем по grid-area (для дерева пассивок)
                if (ga.includes('Cluster')) forced = 'ClusterJewel';
                else if (ga.includes('Jewel') || ga.includes('Passive')) forced = 'BaseJewel';

                // Если по grid-area непонятно, ищем заголовок H3 выше по DOM
                if (!forced) {
                    let curr = item;
                    while (curr && curr !== document.body && curr.parentElement) {
                        // Если зашли в блок статистики, выходим
                        if (curr.classList.contains('character-stats') || curr.tagName === 'ASIDE') break;

                        let prev = curr.previousElementSibling;
                        while (prev) {
                            const h3 = (prev.tagName === 'H3') ? prev : prev.querySelector('h3');
                            if (h3) {
                                const txt = h3.innerText.toLowerCase();
                                if (txt.includes('cluster')) forced = 'ClusterJewel';
                                else if (txt.includes('base jewel')) forced = 'BaseJewel';
                                else if (txt.includes('jewel')) forced = 'BaseJewel';
                                else if (txt.includes('other')) forced = 'OtherJewel';
                                break;
                            }
                            prev = prev.previousElementSibling;
                        }
                        if (forced) break;
                        curr = curr.parentElement;
                    }
                }

                if (forced) {
                    item.dataset.forcedSlot = forced;
                    validNodes.push(item);
                }
            }

            log(`Отфильтровано узлов с тултипом (шмотки + фласки + джевела): ${validNodes.length}`);

            if (validNodes.length === 0) {
                throw new Error("Не удалось найти слоты предметов с тултипами. Подгрузите страницу до конца.");
            }

            for (let i = 0; i < validNodes.length; i++) {
                const node = validNodes[i];
                let slotId = node.dataset.forcedSlot || null;

                if (!slotId) {
                    const ga = node.style.gridArea;
                    for (const k of slotKeysSorted) {
                        if (ga.startsWith(k)) { slotId = slotMap[k]; break; }
                    }
                }

                btn.innerText = `Парсинг ${slotId} (${i + 1}/${validNodes.length})...`;

                const comp = window.getComputedStyle(node);
                const bgImage = node.style.backgroundImage || comp.backgroundImage || '';
                const borderImage = node.style.borderImageSource || comp.borderImageSource || node.style.borderImage || '';

                let iconUrl = '';
                const urlMatch = bgImage.match(/url\("?([^"]+)"?\)/) || borderImage.match(/url\("?([^"]+)"?\)/);
                if (urlMatch) {
                    iconUrl = urlMatch[1];
                } else if (node.tagName.toLowerCase() === 'img') {
                    iconUrl = node.src;
                } else {
                    // Пробуем найти картинку внутри или в фоне вложенных элементов
                    const img = node.querySelector('img:not([alt="Socketed Item"]):not([src*="socket"])');
                    if (img) {
                        iconUrl = img.src;
                    } else {
                        const subWithBg = node.querySelector('[style*="background-image"]');
                        if (subWithBg) {
                            const subBg = window.getComputedStyle(subWithBg).backgroundImage;
                            const subMatch = subBg.match(/url\("?([^"]+)"?\)/);
                            if (subMatch) iconUrl = subMatch[1];
                        }
                    }
                }

                log(`Слот: ${slotId} | Иконка: ${iconUrl ? iconUrl : 'НЕТ'}`);

                let name = 'Неизвестный предмет';
                const tooltipId = node.getAttribute('data-tooltip-id');
                log(`Слот: ${slotId} | Эмуляция мыши для тултипа ${tooltipId}...`);

                emulateHover(node);

                let tooltipHtml = null;
                // Ждем пока появится тултип
                for (let attempt = 0; attempt < 25; attempt++) {
                    await delay(40);
                    // Тултип имеет роль tooltip и тот же data-tooltip-id, что и слот!
                    tooltipHtml = document.querySelector(`div[role="tooltip"][data-tooltip-id="${tooltipId}"]`);
                    if (tooltipHtml) break;
                }

                let tooltipRaw = '';
                let isGemItem = false;
                if (tooltipHtml) {
                    const h1 = tooltipHtml.querySelector('header h1');
                    if (h1) {
                        const text = h1.innerText.trim();
                        const lines = text.split('\n');
                        name = lines[0].trim();
                    }

                    // Проверка: не гем ли это?
                    const isGem = (html, itemName) => {
                        const low = html.toLowerCase();
                        const lowName = (itemName || '').toLowerCase();
                        return low.includes('item-gem') ||
                            low.includes('place into an item socket') ||
                            low.includes('right click to remove from a socket') ||
                            lowName.endsWith(' support') ||
                            lowName.includes(' awakened ');
                    };

                    if (isGem(tooltipHtml.innerHTML, name) || (iconUrl && iconUrl.toLowerCase().includes('/gems/'))) {
                        log(`Слот: ${slotId} | ЭТО ГЕМ, ПРОПУСКАЕМ!`);
                        isGemItem = true;
                    }

                    // Копируем содержимое тултипа (внутренний div с контентом)
                    const contentDiv = tooltipHtml.querySelector('.relative.whitespace-pre-wrap');
                    if (contentDiv) {
                        tooltipRaw = contentDiv.innerHTML;
                    } else {
                        tooltipRaw = tooltipHtml.innerHTML;
                    }

                    log(`Слот: ${slotId} | Имя из тултипа: "${name}" | Тултип захвачен`);
                }

                emulateUnhover(node);
                await delay(30);

                if (isGemItem) continue;

                const itemData = {
                    inventoryId: slotId,
                    icon: iconUrl,
                    name: name,
                    tooltip: tooltipRaw
                };

                // Логика добавления: разрешаем до 45 джевелов в сумме
                if (slotId === 'Flask') {
                    if (items.filter(item => item.inventoryId === 'Flask').length < 5) {
                        items.push(itemData);
                    }
                } else if (slotId === 'Jewel' || slotId === 'ClusterJewel' || slotId === 'BaseJewel' || slotId === 'OtherJewel') {
                    const totalJewels = items.filter(item =>
                        item.inventoryId === 'Jewel' ||
                        item.inventoryId === 'ClusterJewel' ||
                        item.inventoryId === 'BaseJewel' ||
                        item.inventoryId === 'OtherJewel'
                    ).length;
                    if (totalJewels < 45) {
                        items.push(itemData);
                    }
                } else if (!items.find(item => item.inventoryId === slotId)) {
                    items.push(itemData);
                }
            }

            if (items.length === 0) {
                throw new Error("Не удалось извлечь предметы. Сайт мог изменить разметку.");
            }

            const exportData = { items: items };
            log("Итоговый JSON шмота:", exportData);

            await navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));

            btn.innerText = '✔ КОД СКОПИРОВАН!';
            btn.style.backgroundColor = '#059669';
            btn.style.borderColor = '#047857';
            setTimeout(() => {
                btn.innerText = originalText;
                btn.style.backgroundColor = '#10b981';
                btn.style.borderColor = '#059669';
            }, 2500);

        } catch (e) {
            log(`КРИТИЧЕСКАЯ ОШИБКА: ${e.message}`);
            console.error(e);
            alert("Ошибка сбора: " + e.message + "\n\nДетали в консоли (F12).");
            btn.innerText = originalText;
        }
    }

    function addExportButton() {
        if (document.getElementById('build-pricer-export-btn')) return;

        const header = document.querySelector('header');
        if (!header) return;

        const btn = document.createElement('button');
        btn.id = 'build-pricer-export-btn';
        btn.innerText = 'Скопировать шмот для Pricer';
        btn.style.cssText = `
            position: fixed;
            top: 70px;
            right: 20px;
            z-index: 99999;
            background-color: #10b981;
            color: white;
            border: 2px solid #059669;
            padding: 10px 15px;
            border-radius: 6px;
            font-weight: bold;
            font-size: 14px;
            cursor: pointer;
            box-shadow: 0 4px 10px rgba(0,0,0,0.5);
            transition: all 0.2s ease-in-out;
        `;

        btn.onmouseover = () => { if (btn.innerText.includes('Скопировать')) btn.style.backgroundColor = '#059669'; };
        btn.onmouseout = () => { if (btn.innerText.includes('Скопировать')) btn.style.backgroundColor = '#10b981'; };

        btn.onclick = () => extractFromDOM(btn);

        document.body.appendChild(btn);
    }

    setInterval(addExportButton, 1500);
    setTimeout(addExportButton, 500);
})();

// 初始化 Fabric.js 畫布
const canvas = new fabric.Canvas('editorCanvas', {
    selection: true
});
const statusText = document.getElementById('statusText');
const apiKeyInput = document.getElementById('apiKeyInput');

// 載入 localStorage 中的 API Key
apiKeyInput.value = localStorage.getItem('geminiApiKey') || '';

function saveApiKey() {
    localStorage.setItem('geminiApiKey', apiKeyInput.value);
    alert('API Key 已儲存於瀏覽器暫存中！');
}

// History Stack 實作還原功能
let historyStack = [];
let isHistoryProcessing = false;

function saveHistory() {
    if (isHistoryProcessing) return;
    const json = canvas.toJSON(['customType', 'x1', 'y1', 'x2', 'y2', 'customColor']);
    historyStack.push(JSON.stringify(json));
}

// 綁定事件觸發儲存歷史
canvas.on('object:added', saveHistory);
canvas.on('object:modified', saveHistory);
canvas.on('object:removed', saveHistory);

function undo() {
    if (historyStack.length > 1) {
        isHistoryProcessing = true;
        historyStack.pop(); // 丟棄當前狀態
        const previousState = historyStack[historyStack.length - 1];

        canvas.loadFromJSON(previousState, function() {
            canvas.renderAll();
            isHistoryProcessing = false;
            statusText.innerText = "已還原至上一步";
        });
    } else {
        statusText.innerText = "沒有上一步可以還原了";
    }
}

// 綁定鍵盤刪除事件
window.addEventListener('keydown', function(e) {
    if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelected();
    }
});

function applyColor() {
    const color = document.getElementById('colorPicker').value;
    const activeObjects = canvas.getActiveObjects();

    if (activeObjects.length === 0) {
        statusText.innerText = "請先點選畫布上的元件，再套用顏色！";
        return;
    }

    isHistoryProcessing = true;
    activeObjects.forEach(obj => {
        obj.set('customColor', color);
        if (obj.customType === 'text') {
            obj.set('fill', color);
        } else if (obj.type === 'group') {
            obj._objects.forEach(child => {
                if (child.type === 'text') {
                    child.set('fill', color);
                } else if (child.stroke) {
                    child.set('stroke', color);
                }
                if (child.fill && child.fill !== 'transparent' && child.type !== 'text' && child.type !== 'rect') {
                    // For arrow head
                    child.set('fill', color);
                }
            });
        } else {
            obj.set('stroke', color);
        }
    });
    canvas.renderAll();
    isHistoryProcessing = false;
    saveHistory();
    statusText.innerText = `已將選取元件的顏色更改為 ${color}`;
}

function deleteSelected() {
    let activeObjects = canvas.getActiveObjects();
    if (activeObjects.length) {
        canvas.discardActiveObject();
        activeObjects.forEach(function(object) {
            canvas.remove(object);
        });
        statusText.innerText = "已刪除選取元件";
    }
}

// 處理圖片上傳與後端 AI 自動運算模擬
document.getElementById('imageInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const apiKey = localStorage.getItem('geminiApiKey') || apiKeyInput.value;
    if (!apiKey) {
        alert('請先在上方輸入您的 Google Gemini API 金鑰！');
        e.target.value = '';
        return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("api_key", apiKey);

    try {
        statusText.innerText = "正在呼叫 Google Gemini 視覺模型分析圖面... 請稍候 (可能需要 10-20 秒)";
        const response = await fetch('/upload', { method: 'POST', body: formData });
        const data = await response.json();

        if (data.error) {
            alert("AI 辨識錯誤: " + data.error);
            statusText.innerText = "辨識失敗：" + data.error;
            e.target.value = '';
            return;
        }

        isHistoryProcessing = true;
        canvas.clear(); // 先清空舊物件與畫布
        
        // 設定畫布尺寸與手繪圖相同，但不顯示手繪底圖
        const cw = data.width || 1000;
        const ch = data.height || 600;
        canvas.setWidth(cw);
        canvas.setHeight(ch);
        canvas.backgroundColor = '#fafafa';
        
        statusText.innerText = "AI 辨識完成！已自動將草圖轉換為可編輯的元件。";
        
        // 繪製 AI 辨識出的物件
        if (data.elements && data.elements.length > 0) {
            renderElements(data.elements);
        }
        
        canvas.renderAll();
        isHistoryProcessing = false;
        
        // 重置並記錄初始歷史狀態
        historyStack = [];
        saveHistory();
        
        // 清空 input，讓使用者可以重複上傳同一張照片
        e.target.value = '';
        
    } catch (error) {
        console.error("上傳失敗", error);
        statusText.innerText = "辨識失敗，請重試。";
        e.target.value = '';
    }
});

// 手動新增元件
document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const type = e.target.getAttribute('data-tool');
        const defaultX = canvas.width / 2;
        const defaultY = canvas.height / 2;
        renderElements([{ type: type, x: defaultX, y: defaultY }]);
        statusText.innerText = `已在畫面中央加入 ${type}，請拖拉它到對的位置。`;
    });
});

function renderElements(elements) {
    elements.forEach(item => {
        let obj = null;
        if (item.type === 'pipe') {
            obj = new fabric.Line([item.x1, item.y1, item.x2, item.y2], {
                stroke: '#28a745',
                strokeWidth: 8,
                hasControls: true,
                hasBorders: true,
                originX: 'center',
                originY: 'center',
                customType: 'pipe'
            });
            // 允許改變長度
            obj.setControlsVisibility({ mt: false, mb: false, ml: true, mr: true });
        } else if (item.type === 'meter') {
            let f1 = new fabric.Line([-30, -15, -30, 15], { stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center' });
            let l1 = new fabric.Line([-30, 0, -15, 0], { stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center' });
            let c = new fabric.Circle({ radius: 15, fill: 'rgba(255,255,255,0.8)', stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center' });
            let t = new fabric.Text('M', { fontSize: 20, fill: '#0056b3', originX: 'center', originY: 'center' });
            let l2 = new fabric.Line([15, 0, 30, 0], { stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center' });
            let f2 = new fabric.Line([30, -15, 30, 15], { stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center' });
            obj = new fabric.Group([f1, l1, c, t, l2, f2], { left: item.x - 30, top: item.y - 15, customType: 'meter' });
        } else if (item.type === 'valve') {
            let rect = new fabric.Rect({
                width: 40, height: 40, fill: 'rgba(255,255,255,0.8)', stroke: '#0056b3', strokeWidth: 3,
                originX: 'center', originY: 'center'
            });
            let line1 = new fabric.Line([-20, -20, 20, 20], { stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center' });
            let line2 = new fabric.Line([-20, 20, 20, -20], { stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center' });
            obj = new fabric.Group([rect, line1, line2], {
                left: item.x - 20, top: item.y - 20, customType: 'valve'
            });
        } else if (item.type === 'sleeve') {
            let opts = { stroke: '#0056b3', strokeWidth: 3, fill: 'transparent', originX: 'center', originY: 'center', strokeLineJoin: 'round' };
            let leftPath = new fabric.Polyline([
                {x: -15, y: -20}, {x: -15, y: -8}, {x: -5, y: -8}, {x: -5, y: 8}, {x: -15, y: 8}, {x: -15, y: 20}
            ], opts);
            let rightPath = new fabric.Polyline([
                {x: 15, y: -20}, {x: 15, y: -8}, {x: 5, y: -8}, {x: 5, y: 8}, {x: 15, y: 8}, {x: 15, y: 20}
            ], opts);
            let centerLine = new fabric.Line([-5, 0, 5, 0], { stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center' });
            obj = new fabric.Group([leftPath, rightPath, centerLine], { left: item.x - 15, top: item.y - 20, customType: 'sleeve' });
        } else if (item.type === 'short_a') {
            let opts = { stroke: '#0056b3', strokeWidth: 3, fill: 'transparent', originX: 'center', originY: 'center', strokeLineJoin: 'round' };
            let f1 = new fabric.Line([-15, -20, -15, 20], { stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center' });
            let l1 = new fabric.Line([-15, 0, 5, 0], { stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center' });
            let rightPath = new fabric.Polyline([
                {x: 15, y: -20}, {x: 15, y: -8}, {x: 5, y: -8}, {x: 5, y: 8}, {x: 15, y: 8}, {x: 15, y: 20}
            ], opts);
            obj = new fabric.Group([f1, l1, rightPath], { left: item.x - 15, top: item.y - 20, customType: 'short_a' });
        } else if (item.type === 'short_b') {
            let f1 = new fabric.Line([-20, -15, -20, 15], { stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center' });
            let l1 = new fabric.Line([-20, 0, 20, 0], { stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center' });
            obj = new fabric.Group([f1, l1], { left: item.x - 20, top: item.y - 15, customType: 'short_b' });
        } else if (item.type === 'text') {
            obj = new fabric.IText('點兩下編輯文字', {
                left: item.x, top: item.y, customType: 'text',
                fill: '#000000', fontSize: 24, fontFamily: 'Arial'
            });
        } else if (item.type === 'arrow') {
            let line = new fabric.Line([-20, 0, 15, 0], { stroke: '#e83e8c', strokeWidth: 4, originX: 'center', originY: 'center' });
            let head = new fabric.Triangle({ width: 15, height: 15, fill: '#e83e8c', originX: 'center', originY: 'center', left: 20, angle: 90 });
            obj = new fabric.Group([line, head], { left: item.x - 20, top: item.y - 10, customType: 'arrow' });
        } else if (item.type === 'reducer_1' || item.type === 'reducer') {
            let p = new fabric.Polygon([{x: -15, y: -15}, {x: 15, y: -8}, {x: 15, y: 8}, {x: -15, y: 15}], {
                fill: 'rgba(255,255,255,0.8)', stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center'
            });
            let l1 = new fabric.Line([-15, -15, -15, 15], { stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center' });
            let l2 = new fabric.Line([15, -8, 15, 8], { stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center' });
            obj = new fabric.Group([p, l1, l2], { left: item.x - 15, top: item.y - 15, customType: 'reducer_1' });
        } else if (item.type === 'reducer_2') {
            let opts = { stroke: '#0056b3', strokeWidth: 3, fill: 'transparent', originX: 'center', originY: 'center', strokeLineJoin: 'round' };
            let l1 = new fabric.Polyline([{x: -15, y: -15}, {x: -15, y: -5}, {x: -8, y: 0}, {x: -15, y: 5}, {x: -15, y: 15}], opts);
            let topL = new fabric.Polyline([{x: -15, y: -15}, {x: 10, y: -5}, {x: 25, y: -5}], opts);
            let botL = new fabric.Polyline([{x: -15, y: 15}, {x: 10, y: 5}, {x: 25, y: 5}], opts);
            obj = new fabric.Group([l1, topL, botL], { left: item.x - 15, top: item.y - 15, customType: 'reducer_2' });
        } else if (item.type === 'reducer_3') {
            let opts = { stroke: '#0056b3', strokeWidth: 3, fill: 'transparent', originX: 'center', originY: 'center', strokeLineJoin: 'round' };
            let l1 = new fabric.Polyline([{x: -15, y: -15}, {x: -15, y: -5}, {x: -8, y: 0}, {x: -15, y: 5}, {x: -15, y: 15}], opts);
            let topL = new fabric.Polyline([{x: -15, y: -15}, {x: 10, y: -5}, {x: 25, y: -5}], opts);
            let botL = new fabric.Polyline([{x: -15, y: 15}, {x: 10, y: 5}, {x: 25, y: 5}], opts);
            let zig = new fabric.Polyline([{x: 25, y: -5}, {x: 20, y: -2}, {x: 30, y: 2}, {x: 25, y: 5}], opts);
            obj = new fabric.Group([l1, topL, botL, zig], { left: item.x - 15, top: item.y - 15, customType: 'reducer_3' });
        } else if (item.type === 'tee') {
            let l1 = new fabric.Line([-20, 0, 20, 0], {stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center'});
            let l2 = new fabric.Line([0, 0, 0, 20], {stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center'});
            let f1 = new fabric.Line([-20, -10, -20, 10], {stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center'});
            let f2 = new fabric.Line([20, -10, 20, 10], {stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center'});
            let f3 = new fabric.Line([-10, 20, 10, 20], {stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center'});
            obj = new fabric.Group([l1, l2, f1, f2, f3], { left: item.x - 20, top: item.y - 10, customType: 'tee' });
        } else if (item.type === 'elbow90') {
            let l1 = new fabric.Line([-15, -15, -15, 15], {stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center'});
            let l2 = new fabric.Line([-15, 15, 15, 15], {stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center'});
            let f1 = new fabric.Line([-25, -15, -5, -15], {stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center'});
            let f2 = new fabric.Line([15, 5, 15, 25], {stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center'});
            obj = new fabric.Group([l1, l2, f1, f2], { left: item.x - 25, top: item.y - 15, customType: 'elbow90' });
        } else if (item.type === 'elbow45') {
            let l1 = new fabric.Line([-15, 0, 0, 0], {stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center'});
            let l2 = new fabric.Line([0, 0, 15, 15], {stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center'});
            let f1 = new fabric.Line([-15, -10, -15, 10], {stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center'});
            let f2 = new fabric.Line([8, 22, 22, 8], {stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center'});
            obj = new fabric.Group([l1, l2, f1, f2], { left: item.x - 15, top: item.y - 10, customType: 'elbow45' });
        } else if (item.type === 'quick_release') {
            let l1 = new fabric.Line([-15, 0, 15, 0], {stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center'});
            let f1 = new fabric.Line([-15, -15, -15, 15], {stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center'});
            let f2 = new fabric.Line([0, -12, 0, 12], {stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center'});
            let f3 = new fabric.Line([15, -15, 15, 15], {stroke: '#0056b3', strokeWidth: 3, originX: 'center', originY: 'center'});
            obj = new fabric.Group([l1, f1, f2, f3], { left: item.x - 15, top: item.y - 15, customType: 'quick_release' });
        }

        if (obj) {
            canvas.add(obj);
        }
    });
}

// 產生並下載 DXF
async function generateDXF() {
    const objects = canvas.getObjects();
    if (objects.length === 0) {
        alert("畫面上沒有任何元件可以匯出！");
        return;
    }

    const payload = [];
    objects.forEach(obj => {
        if (!obj.customType) return;

        let item = { type: obj.customType, angle: obj.angle || 0 };

        if (obj.customType === 'pipe') {
            // 計算縮放/旋轉後的實際座標
            let p1 = new fabric.Point(obj.x1, obj.y1);
            let p2 = new fabric.Point(obj.x2, obj.y2);
            let transform = obj.calcTransformMatrix();
            let actualP1 = fabric.util.transformPoint(p1, transform);
            let actualP2 = fabric.util.transformPoint(p2, transform);
            item.x1 = actualP1.x;
            item.y1 = actualP1.y;
            item.x2 = actualP2.x;
            item.y2 = actualP2.y;
        } else if (obj.customType === 'text') {
            item.x = obj.left;
            item.y = obj.top;
            item.text = obj.text;
            item.color = obj.fill;
        } else {
            // Group elements (meter, valve, sleeve, arrow)
            item.x = obj.left + (obj.width * obj.scaleX) / 2;
            item.y = obj.top + (obj.height * obj.scaleY) / 2;
        }
        item.color = item.color || obj.customColor || (obj.customType === 'pipe' ? '#28a745' : (obj.customType === 'arrow' ? '#e83e8c' : '#0056b3'));
        payload.push(item);
    });

    try {
        statusText.innerText = "產生 DXF 檔案中...";
        const response = await fetch('/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: payload })
        });

        const data = await response.json();

        if (data.downloadUrl) {
            statusText.innerText = "產生成功！即將下載。";
            window.location.href = data.downloadUrl;
        } else {
            throw new Error("找不到下載連結");
        }
    } catch (error) {
        console.error("生成失敗", error);
        statusText.innerText = "產生失敗，請重試。";
    }
}
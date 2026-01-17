# ComfyUI Sticky Notes

Figma/Miro 스타일의 스티키 노트 확장 기능입니다. 워크플로우에 메모를 추가하고 마크다운으로 서식을 지정할 수 있습니다.

## 기능

- **스티키 노트 생성**: T + 클릭으로 캔버스 어디든 노트 추가
- **마크다운 지원**: 굵게, 기울임, 코드, 링크, 헤더, 리스트 등
- **5가지 색상**: 노란색, 분홍색, 파란색, 초록색, 회색
- **크기 조절**: 우측 하단 모서리 드래그로 크기 변경
- **워크플로우 저장**: 노트가 워크플로우와 함께 저장/로드됨

## 설치 방법

### Git Clone (권장)
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/0dot77/comfyui-sticky-notes.git
```

### 수동 설치
1. 이 저장소를 ZIP으로 다운로드
2. `ComfyUI/custom_nodes/` 폴더에 압축 해제
3. ComfyUI 재시작

## 사용 방법

### 단축키

| 동작 | 단축키 |
|------|--------|
| 노트 생성 | `T` + 클릭 |
| 텍스트 편집 | 더블클릭 |
| 편집 저장 | `Enter` |
| 줄바꿈 | `Shift + Enter` |
| 편집 취소 | `Escape` |
| 노트 삭제 | `Delete` 또는 `Backspace` |

### 마크다운 문법

```markdown
**굵게** 또는 __굵게__
*기울임* 또는 _기울임_
~~취소선~~
`인라인 코드`
[링크](https://example.com)

# 제목 1
## 제목 2
### 제목 3

- 불릿 리스트
* 불릿 리스트

1. 숫자 리스트

> 인용문

---

```코드 블록```
```

## 확인 방법

1. ComfyUI를 시작하고 브라우저에서 엽니다
2. 개발자 도구를 엽니다 (F12 또는 Cmd+Option+I)
3. Console 탭에서 다음 메시지를 확인합니다:
   ```
   sticky-notes loaded - overlay attached to canvas parent
   ```

## 라이선스

MIT License

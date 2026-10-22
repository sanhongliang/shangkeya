import { useRef, useState, type ChangeEvent } from 'react';
import { Brush, FileImage } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useAppData } from '@/data/app-store';
import type { ISettings } from '@/data/types';

const BOARD_OPTIONS = [
  { value: 'white', label: '白板' },
  { value: 'black', label: '黑板' },
  { value: 'green', label: '边框绿版' },
  { value: 'custom', label: '自定义背景板' },
] as const;

/** tiff 课件设置项：标签 + ISettings 键 */
const TIFF_OPTIONS: [string, keyof ISettings][] = [
  ['跳过课件首页', 'skipCoursewareHome'],
  ['隐藏题目时间地域', 'hideQuestionTimeRegion'],
  ['隐藏题目信息', 'hideQuestionInfo'],
  ['显示题目答案', 'showAnswer'],
  ['显示页面备注', 'showPageRemark'],
  ['启用下页预览(需要渗透点击出现内容的课件,建议开启)', 'enableNextPreview'],
];

export default function SettingsPage() {
  const { data, setData } = useAppData();
  const [settings, setSettings] = useState<ISettings>({ ...data.settings });

  const patch = (partial: Partial<ISettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    // 默认自动保存到全局数据（无需点击保存按钮）
    setData((prev) => ({ ...prev, settings: { ...prev.settings, ...partial } }));
  };

  // 自定义背景板：选择图片 → 转 dataURL 保存
  const fileRef = useRef<HTMLInputElement>(null);
  const onPickImage = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      patch({ customBoardImage: String(reader.result ?? '') });
    };
    reader.readAsDataURL(f);
    e.target.value = '';
  };

  const checkboxRow = (
    label: string,
    checked: boolean,
    onChange: (v: boolean) => void,
    key: string,
  ) => (
    <div
      key={key}
      className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/60"
    >
      <Checkbox id={key} checked={checked} onCheckedChange={(v) => onChange(!!v)} />
      <Label htmlFor={key} className="cursor-pointer text-sm font-normal">
        {label}
      </Label>
    </div>
  );

  return (
    <div className="mx-auto flex h-[calc(100vh-96px)] max-w-[1500px] flex-col rounded-lg border bg-card p-5">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPickImage}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        <div>
          <p className="mb-2 flex items-center gap-1.5 pl-[1em] text-[15px] font-semibold text-foreground">
            <FileImage className="h-4 w-4 text-primary" />
            tiff 课件设置
          </p>
          <Card className="shadow-sm">
            <CardContent className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-6">
              {TIFF_OPTIONS.map(([label, key]) =>
                checkboxRow(
                  label,
                  !!settings[key],
                  (v) => patch({ [key]: v } as Partial<ISettings>),
                  `opt-${key}`,
                ),
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 pl-[1em] text-[15px] font-semibold text-foreground">
            <Brush className="h-4 w-4 text-primary" />
            黑板设置
          </p>
          <Card className="shadow-sm">
            <CardContent>
              <p className="mb-1.5 text-sm font-medium">课堂画板样式</p>
              <RadioGroup
                value={settings.boardStyle}
                onValueChange={(v) => patch({ boardStyle: v as ISettings['boardStyle'] })}
                className="grid grid-cols-2 gap-2.5 sm:grid-cols-4"
              >                {BOARD_OPTIONS.map((opt) => (
                  <div
                    key={opt.value}
                    className="flex flex-col items-center gap-2 rounded-lg bg-card p-3 transition-colors hover:shadow-sm"
                  >
                    <div
                      onClick={() => {
                        patch({ boardStyle: opt.value });
                        if (opt.value === 'custom') fileRef.current?.click();
                      }}
                      title={opt.value === 'custom' ? '点击选择背景图片' : undefined}
                      style={{
                        backgroundImage:
                          opt.value === 'custom' && settings.customBoardImage
                            ? `url("${settings.customBoardImage}")`
                            : undefined,
                        backgroundSize: '100% 100%',
                        backgroundPosition: 'center',
                      }}
                      className={
                        (opt.value === 'green'
                          ? 'h-20 w-full max-w-[140px] cursor-pointer rounded border-4 border-[#c9a227] bg-[#1f5e36]'
                          : opt.value === 'white'
                            ? 'h-20 w-full max-w-[140px] cursor-pointer rounded border-2 border-black bg-white'
                            : opt.value === 'black'
                              ? 'h-20 w-full max-w-[140px] cursor-pointer rounded border bg-slate-900'
                              : 'h-20 w-full max-w-[140px] cursor-pointer rounded border bg-gradient-to-br from-sky-100 to-indigo-100') +
                        (settings.boardStyle === opt.value
                          ? ' ring-2 ring-blue-500 ring-offset-2'
                          : '')
                      }
                    />
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value={opt.value} id={`board-${opt.value}`} />
                      <Label htmlFor={`board-${opt.value}`} className="text-sm font-normal">
                        {opt.label}
                      </Label>
                    </div>
                  </div>
                ))}
              </RadioGroup>

              <div className="mt-4">
                <p className="mb-1.5 text-sm font-medium">独立黑板窗口设置</p>
                <div className="flex flex-wrap items-center gap-2">
                  <RadioGroup
                    value={settings.boardWindowMode}
                    onValueChange={(v) =>
                      patch({ boardWindowMode: v as ISettings['boardWindowMode'] })
                    }
                    className="flex flex-wrap items-center gap-1.5"
                  >
                    {(
                      [
                        ['separate', '独立黑板窗口（方便腾讯会议共享）'],
                        ['inline', '不使用独立黑板窗口（课堂黑板一体）'],
                      ] as [ISettings['boardWindowMode'], string][]
                    ).map(([m, label]) => (
                      <div
                        key={m}
                        className={
                          'flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-sm transition-colors ' +
                          (settings.boardWindowMode === m
                            ? 'border-primary bg-primary/5'
                            : 'border-input')
                        }
                      >
                        <RadioGroupItem value={m} id={`bwm-${m}`} />
                        <Label htmlFor={`bwm-${m}`} className="cursor-pointer text-xs">
                          {label}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>
              </div>

              <div className="mt-4">
                <p className="mb-1.5 text-sm font-medium">黑板画面比例</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <RadioGroup
                      value={settings.boardAspectMode}
                      onValueChange={(v) =>
                        patch({ boardAspectMode: v as ISettings['boardAspectMode'] })
                      }
                      className="flex flex-wrap items-center gap-1.5"
                    >
                    {(
                      [
                        ['16:9', '16:9（tiff必选）'],
                        ['9:16', '210:297（A4纸）'],
                        ['4:3', '4:3'],
                        ['free', '动态比例（跟随窗口）'],
                        ['followCw', '动态比例（跟随课件）'],
                        ['custom', '自定义比例'],
                      ] as [ISettings['boardAspectMode'], string][]
                    ).map(([m, label]) => (
                      <div
                        key={m}
                        className={
                          'flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-sm transition-colors ' +
                          (settings.boardAspectMode === m
                            ? 'border-primary bg-primary/5'
                            : 'border-input')
                        }
                      >
                        <RadioGroupItem value={m} id={`aspect-${m}`} />
                        <Label htmlFor={`aspect-${m}`} className="cursor-pointer text-xs">
                          {label}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                  {settings.boardAspectMode === 'free' && (
                    <span className="text-xs text-muted-foreground">跟随课件占位区动态设置</span>
                  )}
                  {settings.boardAspectMode === 'custom' && (
                    <div className="flex items-center gap-1.5">
                      <Label className="shrink-0 text-sm">宽</Label>
                      <input
                        type="number"
                        className="h-7 w-20 rounded border px-2 text-sm"
                        value={settings.freeBoardAspectW ?? 878}
                        onChange={(e) => patch({ freeBoardAspectW: Number(e.target.value) || 0 })}
                      />
                      <Label className="shrink-0 text-sm">高</Label>
                      <input
                        type="number"
                        className="h-7 w-20 rounded border px-2 text-sm"
                        value={settings.freeBoardAspectH ?? 494}
                        onChange={(e) => patch({ freeBoardAspectH: Number(e.target.value) || 0 })}
                      />
                    </div>
                  )}
                  </div>
                </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

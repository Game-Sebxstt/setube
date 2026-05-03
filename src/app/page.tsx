"use client"

import { v4 as uuidv4 } from "uuid"
import Image from "next/image"
import { useState, useEffect, useRef, useCallback } from "react"
import type { ClipboardEvent } from "react"
import { Card, CardContent } from "@/components/Card"
import { Button } from "@/components/Button"
import { Input } from "@/components/Input"
import { FormatSelector } from "@/components/FormatSelector"
import { ModeToggle } from "@/components/ModeToggle"
import { ErrorToast } from "@/components/ErrorToast"
import { ConversionProgress } from "@/components/ConversionProgress"
import {
  Download,
  Plus,
  Trash2,
  Youtube,
  Loader2,
  CheckCircle,
  Sparkles,
} from "lucide-react"

interface VideoThumbnail {
  url: string
  width: number
  height: number
}

interface VideoInfo {
  url: string
  title: string
  description: string
  thumbnail: VideoThumbnail
  qualities: string[]
}

interface URL {
  url: string
  id: string
  info?: VideoInfo
  isLoading?: boolean
  isValid?: boolean
}

export interface Playlist {
  id: string,
  thumbnail: {
    url: string,
    width: number,
    height: number
  },
  url: string,
  title: string,
  description: string,
  total_items: number,
  views: number,
}

export interface PlaylistInfo {
  info: Playlist,
  total: number
  urls: string[]
}

interface ConvertedFile {
  filename: string
  timestamp: number
}

type Format = "mp3" | "wav" | "mp4"
type ConversionMode = "urls" | "playlist"
type ConversionType = "audio" | "video"

export default function YouTubeConverter() {
  // 1. API Config
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  // 2. State
  const [urls, setUrls] = useState<URL[]>([])
  const [playlistUrl, setPlaylistUrl] = useState("")
  const [playlistInfo, setPlaylistInfo] = useState<PlaylistInfo | null>(null)
  const [format, setFormat] = useState<Format>("mp3")
  const [mode, setMode] = useState<ConversionMode>("urls")
  const [conversionType, setConversionType] = useState<ConversionType>("audio")
  const [isConverting, setIsConverting] = useState(false)
  const [isLoadingPlaylist, setIsLoadingPlaylist] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showProgress, setShowProgress] = useState(false)
  const [convertedFiles, setConvertedFiles] = useState<ConvertedFile[]>([])
  const [totalFilesToConvert, setTotalFilesToConvert] = useState(0)
  const [isConversionCompleted, setIsConversionCompleted] = useState(false)
  const [, setConvertedCount] = useState(0)

  // 2. Refs
  const eventSourceRef = useRef<EventSource | null>(null)
  const pendingBatchRef = useRef<{ id: string, url: string }[]>([]);
  const batchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const urlTimersRef = useRef<{[key: string]: NodeJS.Timeout}>({});

  // 3. Callbacks (Utils)
  const isValidUrl = useCallback((url: string): boolean => {
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be|music\.youtube\.com)\/.+/
    return youtubeRegex.test(url.trim())
  }, []);

  const saveUrlsToStorage = useCallback((urlsToSave: URL[]) => {
    try {
      const urlsToStore = urlsToSave.map(url => ({
        id: url.id,
        url: url.url
      }));
      localStorage.setItem("setube_urls", JSON.stringify(urlsToStore));
    } catch {}
  }, []);

  const closeEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }, [])

  const showError = useCallback((message: string) => {
    setError(message)
    setIsConverting(false)
    setIsLoadingPlaylist(false)
    closeEventSource()
  }, [closeEventSource])

  // 4. Callbacks (Logic)
  const fetchVideoInfoBatch = useCallback(async (items: { id: string, url: string }[]) => {
    if (items.length === 0) return;
    
    console.log(`[Batch] Enviando batch de ${items.length} videos a ${API_URL}`);

    setUrls(prev => prev.map(u => {
      const item = items.find(i => i.id === u.id);
      return item ? { ...u, isLoading: true, isValid: false, info: undefined } : u;
    }));

    try {
      const response = await fetch(`${API_URL}/video/info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: items.map(i => i.url) })
      });

      if (!response.ok) throw new Error(`Error del servidor: ${response.status}`);

      const data = await response.json();
      console.log("[Batch] Datos recibidos:", data);
      
      setUrls(prev => {
        const updated = prev.map(u => {
          const itemIdx = items.findIndex(i => i.id === u.id);
          if (itemIdx !== -1 && data.urls && data.urls[itemIdx]) {
            return { ...u, info: data.urls[itemIdx], isLoading: false, isValid: true };
          }
          if (itemIdx !== -1) {
            return { ...u, isLoading: false, isValid: false };
          }
          return u;
        });
        
        // Save to storage using the updated list
        const urlsToStore = updated.map(url => ({
          id: url.id,
          url: url.url
        }));
        localStorage.setItem("setube_urls", JSON.stringify(urlsToStore));
        
        return updated;
      });
    } catch (error) {
      console.error("[Batch] Error fetching batch info:", error);
      setUrls(prev => prev.map(u => {
        const item = items.find(i => i.id === u.id);
        return item ? { ...u, isLoading: false, isValid: false } : u;
      }));
      showError("Error al obtener información de los videos");
    }
  }, [showError]);

  const queueUrlForBatch = useCallback((id: string, url: string) => {
    pendingBatchRef.current = pendingBatchRef.current.filter(i => i.id !== id);
    pendingBatchRef.current.push({ id, url });

    if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
    
    batchTimerRef.current = setTimeout(() => {
      const batch = [...pendingBatchRef.current];
      pendingBatchRef.current = [];
      fetchVideoInfoBatch(batch);
    }, 500);
  }, [fetchVideoInfoBatch]);

  const fetchVideoInfo = useCallback((id: string, url: string) => {
    if (!url.trim() || !isValidUrl(url)) return;
    queueUrlForBatch(id, url);
  }, [isValidUrl, queueUrlForBatch]);

  const fetchPlaylistInfo = useCallback(async () => {
    if (!playlistUrl.trim()) return

    setIsLoadingPlaylist(true)
    setPlaylistInfo(null)

    try {
      const response = await fetch(`${API_URL}/audio/playlist`, {
        method: "POST",
        body: JSON.stringify({ url: playlistUrl }),
        headers: {
          "Content-Type": "application/json",
        },
      })

      if (!response.ok) {
        throw new Error(`Error del servidor: ${response.status}`)
      }

      const data: PlaylistInfo = await response.json()
      setPlaylistInfo(data)
    } catch (error) {
      console.error("Error fetching playlist:", error)
      showError("No se pudo obtener la información de la playlist. Verifica la URL.")
    } finally {
      setIsLoadingPlaylist(false)
    }
  }, [playlistUrl, showError]);

  const setupEventSource = useCallback(() => {
    try {
      closeEventSource()

      const eventSource = new EventSource(`${API_URL}/events`)
      eventSourceRef.current = eventSource

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === "success" && data.filename) {
            setConvertedFiles((prev) => [
              ...prev,
              {
                filename: data.filename,
                timestamp: Date.now(),
              },
            ])
          }
        } catch (parseError) {
          console.error("Error parsing SSE data:", parseError)
        }
      }

      eventSource.onerror = () => {
        setTimeout(() => {
          if (eventSource.readyState === EventSource.CLOSED) {
            showError("Se perdió la conexión con el servidor durante la conversión")
          }
        }, 3000)
      }
    } catch (error) {
      console.error("Error setting up EventSource:", error)
      showError("No se pudo establecer conexión en tiempo real con el servidor")
    }
  }, [closeEventSource, showError])

  // 5. Effects
  useEffect(() => {
    try {
      const saved = localStorage.getItem("setube_urls");
      if (saved) {
        const parsed: URL[] = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const urlsWithoutInfo = parsed.map(url => ({
            id: url.id,
            url: url.url,
            isValid: false,
            isLoading: isValidUrl(url.url)
          }));
          setUrls(urlsWithoutInfo);
          urlsWithoutInfo.forEach((url, index) => {
            if (isValidUrl(url.url)) {
              setTimeout(() => {
                fetchVideoInfo(url.id, url.url);
              }, index * 300);
            }
          });
        }
      } else {
        setUrls([{ id: uuidv4(), url: "", isLoading: false, isValid: false }]);
      }
    } catch {
      setUrls([{ id: uuidv4(), url: "", isLoading: false, isValid: false }]);
    }
  }, [fetchVideoInfo, isValidUrl]);

  useEffect(() => {
    if (mode === "playlist" && playlistUrl.trim()) {
      const timer = setTimeout(() => {
        fetchPlaylistInfo()
      }, 1000)
      return () => clearTimeout(timer)
    } else {
      setPlaylistInfo(null)
    }
  }, [playlistUrl, mode, fetchPlaylistInfo])

  useEffect(() => {
    return () => {
      closeEventSource()
    }
  }, [closeEventSource])

  // 6. Handlers
  const handleClearUrls = () => {
    setUrls((prevUrls) => {
        const newUrls = prevUrls.length > 1 ? [prevUrls[0]] : prevUrls
        saveUrlsToStorage(newUrls)
        return newUrls
    })
  }

  const handleConvert = async () => {
    setIsConverting(true)
    setConvertedCount(0)
    setConvertedFiles([])
    setIsConversionCompleted(false)

    try {
      let urlsToConvert: string[] = []

      if (mode === "playlist") {
        if (!playlistInfo || !playlistInfo.urls.length) {
          throw new Error("No hay información de playlist disponible")
        }
        urlsToConvert = playlistInfo.urls
        setTotalFilesToConvert(playlistInfo.total)
        setShowProgress(true)
        setupEventSource()
      } else {
        const validUrls = urls.filter((url) => url.url.trim()).map((url) => url.url)
        if (validUrls.length === 0) {
          throw new Error("Por favor ingresa al menos una URL válida")
        }
        urlsToConvert = validUrls
        setTotalFilesToConvert(validUrls.length)
      }

      const endpoint = conversionType === "audio" ? "audio" : "video"
      const response = await fetch(`${API_URL}/${endpoint}/convert`, {
        method: "POST",
        body: JSON.stringify({ urls: urlsToConvert, format }),
        headers: {
          "Content-Type": "application/json",
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Error en la conversión: ${response.status} - ${errorText}`)
      }

      const defaultFilename = urlsToConvert.length > 1 ? `download.zip` : `download.${format}`

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url

      const contentDisposition = response.headers.get("Content-Disposition");
      let filename = defaultFilename;

      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
        if (filenameMatch && filenameMatch[1]) {
          filename = decodeURIComponent(filenameMatch[1]);
        } else {
          const filenameMatchLegacy = contentDisposition.match(/filename="([^"]+)"/i);
          if (filenameMatchLegacy && filenameMatchLegacy[1]) {
            filename = filenameMatchLegacy[1];
          }
        }
      }
      
      a.download = filename;
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)

      setConvertedCount(urlsToConvert.length)
      setIsConversionCompleted(true)

      setTimeout(() => {
        closeEventSource()
      }, 2000)
    } catch (error) {
      console.error("Error:", error)
      showError(error instanceof Error ? error.message : "Error desconocido en la conversión")
    } finally {
      setIsConverting(false)
    }
  }

  const addNewUrl = () => {
    const newUrl = { id: uuidv4(), url: "" }
    setUrls((prevUrls) => {
        const updated = [...prevUrls, newUrl]
        saveUrlsToStorage(updated)
        return updated
    })
  }

  const removeUrl = (id: string) => {
    setUrls((prev) => {
        const filtered = prev.filter((url) => url.id !== id)
        saveUrlsToStorage(filtered)
        return filtered
    })
  }

  const handleUrlChange = (id: string, value: string) => {
    if (urlTimersRef.current[id]) {
      clearTimeout(urlTimersRef.current[id]);
    }
    
    const hasValidFormat = isValidUrl(value);
    
    setUrls((prevUrls) => {
      const updated = prevUrls.map((prevUrl) => {
        if (prevUrl.id === id) {
          if (!value.trim() || !hasValidFormat) {
            return { ...prevUrl, url: value, isLoading: false, isValid: false, info: undefined };
          } else {
            return { ...prevUrl, url: value };
          }
        }
        return prevUrl;
      })
      saveUrlsToStorage(updated)
      return updated
    });
    
    if (hasValidFormat) {
      setTimeout(() => {
        if (urlTimersRef.current[id]) {
          setUrls((prevUrls) =>
            prevUrls.map((prevUrl) =>
              prevUrl.id === id ? { ...prevUrl, isLoading: true } : prevUrl
            )
          );
        }
      }, 300);

      urlTimersRef.current[id] = setTimeout(() => {
        fetchVideoInfo(id, value);
        delete urlTimersRef.current[id];
      }, 1500);
    }
  }

  const handlePasteUrls = (event: ClipboardEvent<HTMLInputElement>, targetId: string) => {
    const paste = event.clipboardData.getData("text")
    if (!paste) return

    const lines = paste
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    if (lines.length <= 1) return

    event.preventDefault()
    const [firstUrl, ...restUrls] = lines
    const pastedEntries: { id: string; url: string }[] = []
    pastedEntries.push({ id: targetId, url: firstUrl })
    restUrls.forEach((url) => {
      pastedEntries.push({ id: uuidv4(), url })
    })

    const finalEntries = [...pastedEntries];
    setUrls((prevUrls) => {
      const targetIndex = prevUrls.findIndex((url) => url.id === targetId)
      let result: URL[] = []

      if (targetIndex === -1) {
        const newUrlObjects = finalEntries.map((entry) => ({
          id: entry.id,
          url: entry.url,
          isLoading: isValidUrl(entry.url),
          isValid: false,
        }))
        result = [...prevUrls, ...newUrlObjects]
      } else {
        prevUrls.forEach((url, index) => {
          if (index < targetIndex) {
            result.push(url)
          } else if (index === targetIndex) {
            result.push({ ...url, url: finalEntries[0].url, isLoading: isValidUrl(finalEntries[0].url), isValid: false, info: undefined })
            finalEntries.slice(1).forEach((entry) => {
              result.push({ id: entry.id, url: entry.url, isLoading: isValidUrl(entry.url), isValid: false })
            })
          } else {
            result.push(url)
          }
        })
      }
      saveUrlsToStorage(result)
      return result
    })

    finalEntries.forEach((entry) => {
      if (isValidUrl(entry.url)) {
        console.log(`[Paste] Encolando ${entry.url}`);
        fetchVideoInfo(entry.id, entry.url)
      }
    })
  }

  const handleCloseProgress = () => {
    setShowProgress(false)
    if (!isConverting) closeEventSource()
  }
  
  const handleCancelConversion = () => {
    if (window.confirm('¿Estás seguro que deseas cancelar la conversión?')) {
      setShowProgress(false)
      setIsConverting(false)
      closeEventSource()
      setConvertedFiles([])
      setConvertedCount(0)
      setError('La conversión ha sido cancelada')
    }
  }

  // 7. Render helpers
  const validUrlsCount = urls.filter((url) => isValidUrl(url.url) && url.isValid && url.info).length
  const canConvert = mode === "urls" ? validUrlsCount > 0 : playlistInfo && playlistInfo.urls.length > 0

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-gray-50 to-slate-100">
      <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-8 max-w-3xl">
        {error && <ErrorToast message={error} onClose={() => setError(null)} />}

        <ConversionProgress
          isVisible={showProgress}
          totalFiles={totalFilesToConvert}
          convertedFiles={convertedFiles}
          onClose={handleCloseProgress}
          onCancel={handleCancelConversion}
          isCompleted={isConversionCompleted}
          playlistInfo={playlistInfo?.info}
        />

        <div className="text-center mb-6 sm:mb-8 animate-in fade-in slide-in-from-top duration-1000">
          <div className="flex items-center justify-center gap-2 sm:gap-3 mb-3 sm:mb-4">
            <div className="relative">
              <div className="p-3 sm:p-4 bg-gradient-to-r from-red-500 to-red-600 rounded-2xl shadow-lg">
                <Youtube className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
              </div>
              <div className="absolute -top-1 -right-1 p-0.5 sm:p-1 bg-gradient-to-r from-yellow-400 to-orange-400 rounded-full">
                <Sparkles className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white" />
              </div>
            </div>
          </div>
          <h1 className="text-2xl sm:text-4xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent mb-1 sm:mb-2">
            Setube
          </h1>
          <p className="text-slate-600 text-sm sm:text-lg px-4">Convierte videos y playlists a audio o video de alta calidad</p>
        </div>

        <Card className="shadow-xl border-0 mb-6 sm:mb-8 animate-in fade-in slide-in-from-bottom duration-1000 delay-200">
          <CardContent className="space-y-4 sm:space-y-6">
            <div className="space-y-3 sm:space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-gradient-to-r from-slate-600 to-slate-500 rounded-full"></div>
                <span className="text-xs sm:text-sm font-semibold text-slate-700">Modo de descarga</span>
              </div>
              <ModeToggle mode={mode} onChange={setMode} />
            </div>

            <div className="space-y-3 sm:space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-gradient-to-r from-slate-600 to-slate-500 rounded-full"></div>
                <span className="text-xs sm:text-sm font-semibold text-slate-700">Tipo de conversión</span>
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
                <Button
                  onClick={() => {
                    setConversionType("audio")
                    setFormat("mp3")
                  }}
                  variant={conversionType === "audio" ? "primary" : "ghost"}
                  className="w-full"
                >
                  Audio
                </Button>
                <Button
                  onClick={() => {
                    setConversionType("video")
                    setFormat("mp4")
                  }}
                  variant={conversionType === "video" ? "primary" : "ghost"}
                  className="w-full"
                >
                  Video
                </Button>
              </div>
            </div>

            <div className="space-y-3 sm:space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-gradient-to-r from-slate-600 to-slate-500 rounded-full"></div>
                <span className="text-xs sm:text-sm font-semibold text-slate-700">Formato de salida</span>
              </div>
              <FormatSelector
                value={format}
                onChange={(newFormat) => setFormat(newFormat as Format)}
                options={
                  conversionType === "audio"
                    ? ["mp3", "wav"]
                    : ["mp4"]
                }
              />
            </div>

            <div className="space-y-3 sm:space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-gradient-to-r from-slate-600 to-slate-500 rounded-full"></div>
                <span className="text-xs sm:text-sm font-semibold text-slate-700">
                  {mode === "playlist" ? "URL de Playlist" : "URLs de YouTube"}
                </span>
              </div>

              <div className="relative p-2 overflow-hidden">
                {mode === "urls" ? (
                  <div className="animate-in fade-in slide-in-from-right duration-500 space-y-3 sm:space-y-4">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        onClick={addNewUrl}
                        variant="ghost"
                        size="sm"
                        aria-label="Agregar nueva URL"
                        title="Agregar nueva URL"
                      >
                        <Plus className="w-3 h-3 sm:w-4 sm:h-4" />
                        <span className="hidden xs:inline">Agregar</span>
                      </Button>
                      <Button
                        onClick={handleClearUrls}
                        variant="ghost"
                        size="sm"
                        aria-label="Borrar todas las URLs excepto la primera"
                        title="Borrar todas las URLs excepto la primera"
                        disabled={urls.length <= 1}
                        className="text-red-500 hover:bg-red-50"
                      >
                        <Trash2 className="w-3 h-3 sm:w-4 sm:h-4" />
                        <span className="hidden xs:inline">Borrar</span>
                      </Button>
                    </div>

                    <div className="space-y-2 sm:space-y-3">
                       {urls.map((url, index) => (
                        <div
                          key={url.id}
                          className="animate-in fade-in slide-in-from-left duration-500 space-y-2"
                          style={{ animationDelay: `${index * 100}ms` }}
                        >
                          <div className="flex gap-2 sm:gap-3">
                            <div className="flex-1 relative">
                              <Input
                                type="url"
                                placeholder="https://www.youtube.com/watch?v=..."
                                value={url.url}
                                onChange={(e) => handleUrlChange(url.id, e.target.value)}
                                onPaste={(e) => handlePasteUrls(e, url.id)}
                                className="pr-8 sm:pr-10"
                              />
                              {url.url.trim() && !url.isLoading && url.isValid && url.info && (
                                <CheckCircle className="absolute right-2 sm:right-3 top-1/2 transform -translate-y-1/2 w-3 h-3 sm:w-4 sm:h-4 text-green-500" />
                              )}
                              {url.isLoading && (
                                <Loader2 className="animate-spin absolute right-2 sm:right-3 top-1/2 transform -translate-y-1/2 w-3 h-3 sm:w-4 sm:h-4 text-slate-400" />
                              )}
                            </div>
                            {urls.length > 1 && (
                              <Button
                                onClick={() => removeUrl(url.id)}
                                variant="danger"
                                size="md"
                                className="px-2 sm:px-3"
                              >
                                <Trash2 className="w-3 h-3 sm:w-4 sm:h-4" />
                                <span className="hidden xs:inline">Borrar</span>
                              </Button>
                            )}
                          </div>
                          
                          {url.isValid && url.url.trim() && url.info && (
                            <div className="bg-slate-50 rounded-lg p-2 sm:p-3 border border-slate-200 shadow-sm">
                              <div className="flex flex-col md:flex-row gap-3">
                                <div className="relative w-full md:w-1/3 aspect-video rounded-md overflow-hidden">
                                  <Image 
                                    src={url.info.thumbnail.url} 
                                    alt={url.info.title}
                                    fill
                                    className="object-cover"
                                  />
                                  <div className="absolute bottom-0 right-0 bg-black bg-opacity-70 text-white text-xs px-1 py-0.5 rounded-tl">
                                    {url.info.qualities[0]}
                                  </div>
                                </div>
                                <div className="flex-1 space-y-1 overflow-hidden">
                                  <h3 className="font-semibold text-slate-800 text-sm line-clamp-2">{url.info.title}</h3>
                                  <p className="text-slate-500 text-xs line-clamp-2 mt-1">{url.info.description}</p>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="animate-in fade-in slide-in-from-left duration-500 space-y-4">
                    <Input
                      type="url"
                      placeholder="https://www.youtube.com/playlist?list=..."
                      value={playlistUrl}
                      onChange={(e) => setPlaylistUrl(e.target.value)}
                    />
                    {isLoadingPlaylist && (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                        <span className="ml-2 text-slate-500">Obteniendo información de la playlist...</span>
                      </div>
                    )}
                    {playlistInfo && (
                      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 animate-in zoom-in-95 duration-300">
                        <div className="flex gap-4">
                          <div className="relative w-32 aspect-video rounded-lg overflow-hidden flex-shrink-0">
                            <Image 
                              src={playlistInfo.info.thumbnail.url} 
                              alt={playlistInfo.info.title}
                              fill
                              className="object-cover"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-slate-800 line-clamp-1">{playlistInfo.info.title}</h3>
                            <p className="text-slate-500 text-sm mt-1">{playlistInfo.total} videos encontrados</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <Button
              onClick={handleConvert}
              className="w-full py-4 sm:py-6 text-base sm:text-lg font-bold shadow-lg"
              disabled={!canConvert || isConverting}
              variant="primary"
            >
              {isConverting ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Convirtiendo...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-5 w-5" />
                  {mode === "playlist" ? "Convertir Playlist" : "Convertir Videos"}
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

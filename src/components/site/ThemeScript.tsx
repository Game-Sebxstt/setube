const CODE =
  "try{var t=localStorage.getItem('setube_theme');if(t==='light')document.documentElement.dataset.theme='light'}catch(e){}";

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: CODE }} />;
}

// 导航栏下滑显示文章标题、上滑或停顿时恢复菜单（标题居中替代菜单）
document.addEventListener('DOMContentLoaded', () => {
  let position = window.scrollY || document.documentElement.scrollTop

  // 从 document.title 中提取文章标题并填入导航栏
  const updateTitle = () => {
    const pageName = document.getElementById('page-name')
    if (!pageName) return
    const parts = document.title.split(' | ')
    pageName.innerText = parts.length > 1 ? parts[0] : document.title
  }

  // 下滑显示标题、上滑恢复菜单（动态获取引用，兼容 Pjax 替换 #nav）
  const onScroll = () => {
    const nav = document.getElementById('nav')
    if (!nav) return
    const scroll = window.scrollY || document.documentElement.scrollTop
    nav.classList.toggle('showing-title', scroll > position)
    position = scroll
  }

  window.addEventListener('scroll', onScroll, { passive: true })

  // 点击标题回到顶部：事件委托，避免 Pjax 替换 #nav 后监听失效
  document.addEventListener('click', e => {
    const target = e.target
    if (!target || typeof target.closest !== 'function' || !target.closest('#page-name')) return
    e.preventDefault()
    const nav = document.getElementById('nav')
    if (nav) nav.classList.remove('showing-title')
    if (window.btf && typeof btf.scrollToDest === 'function') {
      btf.scrollToDest(0, 500)
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  })

  updateTitle()

  // Pjax 会替换 #body-wrap（包含 #nav），切换后更新标题并重置滚动基准
  document.addEventListener('pjax:complete', () => {
    updateTitle()
    position = window.scrollY || document.documentElement.scrollTop
  })
})
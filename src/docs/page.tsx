import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';

import { docsCategories, searchDocs, DocItem, DocCategory, Side } from './_data/docs';
import { getFilesByCategory, FrameworkFile } from './_data/files';

export const template = 'plain';

type ViewMode = 'docs' | 'files';

export default function DocsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('docs');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const searchResults = useMemo(() => searchDocs(searchQuery), [searchQuery]);
  const filesByCategory = useMemo(() => getFilesByCategory(), []);
  const isSearching = searchQuery.trim().length > 0;

  return (
    <div className="w-full h-full bg-background overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 flex flex-col gap-6">

        {/* Header */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <h1 className="text-3xl font-bold text-title">LuckyStack Documentation</h1>
              <p className="text-muted text-sm">Everything you need to build with LuckyStack</p>
            </div>
            <Link to="/examples" className="px-4 h-9 bg-blue-500 text-white rounded-md flex items-center justify-center hover:scale-105 transition-all duration-300 text-sm">
              Live Examples →
            </Link>
          </div>

          {/* Search + Mode */}
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <input
                type="text"
                placeholder="Search docs... (api, session, sync)"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); }}
                className="w-full h-10 px-4 pl-10 bg-container border border-container-border rounded-md text-common focus:outline-blue-500"
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">🔍</span>
            </div>
            <div className="flex bg-container border border-container-border rounded-md overflow-hidden">
              <button
                onClick={() => { setViewMode('docs'); }}
                className={`px-4 h-10 text-sm font-medium transition-colors cursor-pointer ${viewMode === 'docs' ? 'bg-blue-500 text-white' : 'text-common hover:bg-container-hover'}`}
              >
                📖 Docs
              </button>
              <button
                onClick={() => { setViewMode('files'); }}
                className={`px-4 h-10 text-sm font-medium transition-colors cursor-pointer ${viewMode === 'files' ? 'bg-blue-500 text-white' : 'text-common hover:bg-container-hover'}`}
              >
                📁 Files
              </button>
            </div>
          </div>
        </div>

        {/* Search Results */}
        {isSearching && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">{searchResults.length} results for "{searchQuery}"</p>
            {searchResults.map(item => (
              <DocItemCard key={item.id} item={item} categoryColor={item.categoryColor} categoryName={item.category} />
            ))}
            {searchResults.length === 0 && (
              <p className="text-muted py-8 text-center">No results found</p>
            )}
          </div>
        )}

        {/* Main Content */}
        {!isSearching && viewMode === 'docs' && (
          <div className="flex gap-6">
            {/* Sidebar */}
            <div className="w-48 flex-shrink-0 hidden lg:flex flex-col gap-1 sticky top-6 self-start">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Topics</p>
              <button
                onClick={() => { setSelectedCategory(null); }}
                className={`text-left px-3 py-2 rounded-md text-sm cursor-pointer ${selectedCategory ? 'text-common hover:bg-container-hover' : 'bg-blue-500 text-white'}`}
              >
                All Topics
              </button>
              {docsCategories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => { setSelectedCategory(cat.id); }}
                  className={`text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 cursor-pointer ${selectedCategory === cat.id ? 'bg-blue-500 text-white' : 'text-common hover:bg-container-hover'}`}
                >
                  <span>{cat.icon}</span>
                  <span className="truncate">{cat.title}</span>
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col gap-6">
              {docsCategories
                .filter(cat => !selectedCategory || cat.id === selectedCategory)
                .map((cat, index, arr) => (
                  <div key={cat.id}>
                    <CategorySection category={cat} />
                    {index < arr.length - 1 && (
                      <div className="border-t border-container-border mt-10" />
                    )}
                  </div>
                ))
              }
            </div>
          </div>
        )}

        {/* Files Mode */}
        {!isSearching && viewMode === 'files' && (
          <div className="flex flex-col gap-8">
            {Object.entries(filesByCategory).map(([category, files]) => (
              <div key={category} className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold text-title">{category}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {files.map(file => (
                    <FileCard key={file.path} file={file} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

// Side Badge
function SideBadge({ side }: { side?: Side }) {
  if (!side) return null;
  const config = {
    client: { bg: 'bg-blue-500', text: 'Client' },
    server: { bg: 'bg-green-600', text: 'Server' },
    shared: { bg: 'bg-purple-500', text: 'Shared' }
  };
  const c = config[side];
  return <span className={`text-xs text-white px-1.5 py-0.5 rounded ${c.bg}`}>{c.text}</span>;
}

// Code Block with syntax highlighting styling
function CodeBlock({ code, language, title }: { code: string; language?: string; title?: string }) {
  return (
    <div className="bg-container2 border border-container2-border rounded-lg overflow-hidden">
      {title && (
        <div className="px-4 py-2 border-b border-container2-border bg-container3 flex items-center justify-between">
          <span className="text-xs font-medium text-muted">{title}</span>
          {language && <span className="text-xs text-muted font-mono">{language}</span>}
        </div>
      )}
      <pre className="p-4 overflow-x-auto text-sm font-mono text-common leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// Category Section
function CategorySection({ category }: { category: DocCategory }) {
  return (
    <div className="flex flex-col gap-6" id={category.id}>
      {/* Header with video */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Video */}
        <div className="lg:w-1/2 bg-container border border-container-border rounded-lg overflow-hidden">
          <div className="aspect-video bg-container3 flex items-center justify-center">
            {category.videoPath ? (
              <video className="w-full h-full object-cover" controls>
                <source src={category.videoPath} type="video/mp4" />
              </video>
            ) : (
              <div className="flex flex-col items-center gap-3 text-muted">
                <span className="text-5xl">{category.icon}</span>
                <span className="text-lg font-medium">{category.title}</span>
                <span className="text-sm">Video tutorial coming soon</span>
              </div>
            )}
          </div>
        </div>

        {/* Intro */}
        <div className="lg:w-1/2 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className={`w-10 h-10 rounded-lg ${category.color} flex items-center justify-center text-white text-xl`}>
              {category.icon}
            </span>
            <h2 className="text-2xl font-bold text-title">{category.title}</h2>
          </div>
          <p className="text-common leading-relaxed">{category.intro}</p>
          <div className="text-sm text-muted">
            {category.items.length} topics covered
          </div>
        </div>
      </div>

      {/* Doc Items */}
      <div className="flex flex-col gap-6">
        {category.items.map(item => (
          <DocItemCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

// Doc Item Card
function DocItemCard({ item, categoryColor, categoryName }: {
  item: DocItem;
  categoryColor?: string;
  categoryName?: string;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="bg-container border border-container-border rounded-lg overflow-hidden">
      {/* Header */}
      <div
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-container-hover"
        onClick={() => { setExpanded(!expanded); }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          {categoryName && (
            <span className={`text-xs text-white px-1.5 py-0.5 rounded ${categoryColor}`}>{categoryName}</span>
          )}
          <h3 className="font-semibold text-title text-lg">{item.title}</h3>
          <SideBadge side={item.side} />
          {item.toggleable && (
            <span className="text-xs bg-orange-500 text-white px-1.5 py-0.5 rounded">⚙️ {item.toggleable}</span>
          )}
        </div>
        <span className="text-muted text-sm">{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Content */}
      {expanded && (
        <div className="p-4 pt-0 flex flex-col gap-4">
          <p className="text-common leading-relaxed">{item.description}</p>

          {item.file && (
            <span className="text-sm text-muted font-mono">📄 {item.file}</span>
          )}

          {/* Code Examples */}
          {item.examples && item.examples.length > 0 && (
            <div className="flex flex-col gap-4">
              {item.examples.map((ex, i) => (
                <CodeBlock key={i} code={ex.code} language={ex.language} title={ex.title} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// File Card with side indicator
function FileCard({ file }: { file: FrameworkFile }) {
  return (
    <div className="bg-container border border-container-border rounded-lg p-4 flex flex-col gap-2 hover:border-blue-400">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-title">{file.name}</span>
        <span className={`text-xs text-white px-1.5 py-0.5 rounded ${file.side === 'server' ? 'bg-green-600' : 'bg-blue-500'}`}>
          {file.side === 'server' ? 'Server' : 'Client'}
        </span>
      </div>
      <p className="text-sm text-common flex-1">{file.description}</p>
      <span className="text-xs text-muted font-mono">{file.path}</span>
    </div>
  );
}

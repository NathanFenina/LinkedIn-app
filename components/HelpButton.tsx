'use client'

import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { HOW_TO_SECTIONS } from '@/lib/how-to-work-sections'

export function HelpButton({ sectionId }: { sectionId: keyof typeof HOW_TO_SECTIONS }) {
  const [open, setOpen] = useState(false)
  const section = HOW_TO_SECTIONS[sectionId]
  if (!section) return null
  const Icon = section.icon

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-blue-600 border border-gray-200 hover:border-blue-300 rounded-full px-2 py-1 transition-colors"
            title="Aide pour cet onglet"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            How to work
          </button>
        }
      />
      <DialogContent className="!max-w-2xl !p-6 max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Icon className="w-4 h-4 text-blue-600" />
            {section.title}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-gray-600 mt-1">{section.goal}</p>

        <div className="mt-3">
          <div className="text-[11px] font-bold uppercase text-gray-400 mb-1.5">
            Comment l&apos;utiliser
          </div>
          <ol className="list-decimal pl-5 space-y-1 text-xs text-gray-700">
            {section.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>

        {section.tips && section.tips.length > 0 && (
          <div className="mt-3">
            <div className="text-[11px] font-bold uppercase text-gray-400 mb-1.5">Astuces</div>
            <ul className="list-disc pl-5 space-y-1 text-xs text-gray-600">
              {section.tips.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

import { User } from 'lucide-react'

export function UserMessage({ message }) {
  return (
    <div className="flex justify-end animate-fade-in">
      <div className="max-w-lg">
        <div className="bg-blue-600 text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed">
          {message.content}
        </div>
      </div>
    </div>
  )
}
